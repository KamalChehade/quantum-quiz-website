import React, { useState, useEffect } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { Play, StopCircle, Users, LogOut, RefreshCw, Trophy, Medal, Award } from 'lucide-react';
import { LeaderboardView } from '../shared/LeaderboardView';

interface AdminDashboardProps {
  onLogout: () => void;
}

interface Question {
  id: number;
  text: string;
  order: number;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const {
    lobbyParticipants,
    gameStatus,
    questionLeaderboard,
    gameLeaderboard,
    adminStartGame,
    adminStartQuestion,
    adminEndQuestion,
    isConnected,
  } = useSocket();
  const { connectAsAdmin, setLobbyParticipantsLocal, setGameStatusLocal, setGameLeaderboardLocal, setQuestionLeaderboardLocal, setParticipantLocal } = useSocket();
  // include raw socket so admin can emit with ack
  const socket = useSocket().socket;

  const [questions, setQuestions] = useState<Question[]>([]);
  // track by index to ensure `0` (first question) is handled correctly
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number | null>(null);
  // when admin refreshes, we may get currentQuestionId before questions are fetched
  const [resumedQuestionId, setResumedQuestionId] = useState<number | null>(null);
  const questionsRef = React.useRef<Question[]>([]);
  const [, setLogs] = useState<string[]>([]);
  const [debugLogs] = useState(true);

  const addLog = (msg: string, data?: any) => {
    const time = formatTime(new Date());
    const entry = `[${time}] ${msg}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;
    setLogs((s) => [...s.slice(-200), entry]);
    if (debugLogs) console.log(entry, data ?? '');
  };

  const formatTime = (iso?: string | Date) => {
    if (!iso) return '';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    const hours = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${hour12}:${mm}:${ss} ${ampm}`;
  };
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'lobby' | 'controls' | 'leaderboard'>('lobby');
  const [adminAckLeaderboard, setAdminAckLeaderboard] = useState<any[] | null>(null);
  const [adminShowFullGameLeaderboard, setAdminShowFullGameLeaderboard] = useState(false);
  // Reset session modal / state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [resetConfirmChecked, setResetConfirmChecked] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
  const expectedSessionId = 1; // fallback session id shown in modal; server defaults to 1 if omitted
  // live feed of participant submissions (most recent first)
  const [liveSubmissions, setLiveSubmissions] = useState<Array<{
    participant: { id?: number; name?: string; phone?: string };
    questionId?: number;
    selectedAnswer?: string;
    isCorrect?: boolean;
    answeredAt?: string;
    gameSessionId?: number;
  }>>([]);

  useEffect(() => {
    fetchQuestions();
  }, []);

  // Warn admin before accidental tab close/refresh while dashboard is open
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      // Most browsers ignore the custom message; setting returnValue triggers the prompt
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  // When we know the resumed question id and questions are loaded, select its index
  useEffect(() => {
    if (resumedQuestionId != null && questionsRef.current.length > 0) {
      const idx = questionsRef.current.findIndex((q) => q.id === resumedQuestionId);
      setCurrentQuestionIndex(idx >= 0 ? idx : null);
    }
  }, [resumedQuestionId, questions]);

  // Always (re)connect as admin on mount using the saved token. This upgrades any
  // anonymous socket to an authenticated admin socket so the server will accept
  // admin_* actions.
  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      try {
        connectAsAdmin(token);
      } catch (err) {
        console.warn('connectAsAdmin (mount) failed', err);
      }
    }
  }, []);

  // Socket: auto-connect as admin and listen for resume/state events
  useEffect(() => {
  // Socket may be swapped by connectAsAdmin; this effect sets up listeners when available
  if (!socket) return;

    const fetchLobbySnapshot = async () => {
      // Try socket ack first
      try {
        if (socket && typeof socket.emit === 'function') {
          socket.timeout(2000).emit('admin_get_lobby', undefined, (...cbArgs: any[]) => {
            try {
              let resp = cbArgs.length === 1 ? cbArgs[0] : cbArgs[1] ?? cbArgs[0];
              const participants = resp?.participants ?? resp ?? [];
              if (Array.isArray(participants)) {
                setLobbyParticipantsLocal(participants);
              }
            } catch (e) {
              /* ignore ack parse */
            }
          });
          return; // don't fall back immediately; ack will arrive if supported
        }
      } catch (e) {
        /* ignore, try REST */
      }

      // Fallback: REST endpoint (best-effort)
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const token = localStorage.getItem('adminToken');
        const res = await fetch(`${apiUrl}/qa-api/participants?gameSessionId=${expectedSessionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setLobbyParticipantsLocal(data);
          if (data?.participants && Array.isArray(data.participants)) setLobbyParticipantsLocal(data.participants);
        }
      } catch (e) {
        /* ignore */
      }
    };

    const onAdminResume = (state: any) => {
      addLog('socket: admin_resume_state', state);
      try {
        if (state?.status) setGameStatusLocal(state.status);
        if (state?.status === 'active') {
          setView('controls');
        }
        // Save for later reconciliation once questions are loaded
        setResumedQuestionId(state?.currentQuestionId ?? null);
        // fetch latest lobby snapshot on resume so counts and list are accurate
        fetchLobbySnapshot();
        showToast('Resumed control of active session', 'info');
      } catch (err) {
        console.warn('resume handler error', err);
      }
    };

    const onLobbyUpdate = (payload: any) => {
      addLog('socket: lobby_update', payload);
      const participants = payload?.participants ?? payload ?? [];
      setLobbyParticipantsLocal(participants);
    };

    const onGameStarted = () => {
      addLog('socket: game_started');
      setGameStatusLocal('active');
      setView('controls');
    };

    const onQuestionStarted = (payload: any) => {
      addLog('socket: question_started', payload);
      const qId = payload?.question?.id ?? payload?.questionId ?? payload;
      // find index
      const idx = questionsRef.current.findIndex((q) => q.id === qId);
      setCurrentQuestionIndex(idx >= 0 ? idx : null);
      // clear inline leaderboard
      setQuestionLeaderboardLocal([]);
      setAdminAckLeaderboard(null);
      setView('controls');
    };

    const onQuestionLeaderboard = (payload: any) => {
      addLog('socket: question_leaderboard', payload);
      const lb = payload?.leaderboard ?? payload ?? [];
      setQuestionLeaderboardLocal(lb);
      setAdminAckLeaderboard(lb);
      // clear current question so admin can start next if desired
      setCurrentQuestionIndex(null);
    };

    const onParticipantSubmitted = (payload: any) => {
      addLog('socket: participant_submitted', payload);
      try {
        const entry = {
          participant: payload?.participant ?? { id: payload?.participantId ?? undefined, name: payload?.name ?? 'Unknown', phone: payload?.phone ?? '' },
          questionId: payload?.questionId ?? payload?.question_id ?? undefined,
          selectedAnswer: payload?.selectedAnswer ?? payload?.selected_answer ?? payload?.selected ?? undefined,
          isCorrect: payload?.isCorrect ?? payload?.correct ?? false,
          answeredAt: payload?.answeredAt ?? payload?.answered_at ?? new Date().toISOString(),
          gameSessionId: payload?.gameSessionId ?? payload?.game_session_id ?? undefined,
        };
        setLiveSubmissions((s) => [entry, ...s].slice(0, 100));
      } catch (err) {
        console.warn('participant_submitted handler error', err);
      }
    };

    const onGameLeaderboard = (payload: any) => {
      addLog('socket: game_leaderboard', payload);
      const lb = payload?.leaderboard ?? payload ?? [];
      setGameLeaderboardLocal(lb);
      setAdminShowFullGameLeaderboard(true);
      setView('leaderboard');
    };

    const onConnect = () => {
      addLog('socket: connect');
      showToast('Connected', 'info');
      // on connect, fetch lobby snapshot so dashboard shows up-to-date participants
      fetchLobbySnapshot();
      // also ask server what the current question is so we can restore End button
      try {
        socket.timeout(2000).emit('admin_get_question', undefined, (...cbArgs: any[]) => {
          try {
            const resp = cbArgs.length === 1 ? cbArgs[0] : cbArgs[1] ?? cbArgs[0];
            const q = resp?.question ?? null;
            setResumedQuestionId(q?.id ?? null);
          } catch {}
        });
      } catch {}
    };
    const onDisconnect = () => {
      addLog('socket: disconnect');
      showToast('Disconnected', 'error');
    };
    const onReconnect = (attempt?: any) => {
      addLog('socket: reconnect', attempt);
      showToast('Reconnected', 'success');
      // Optionally notify server that admin reconnected (if server expects)
      try {
        socket.emit && socket.emit('admin_reconnect');
      } catch (err) {
        /* ignore */
      }
      // refresh lobby snapshot after reconnect
      fetchLobbySnapshot();
      // re-fetch current question id on reconnect
      try {
        socket.timeout(2000).emit('admin_get_question', undefined, (...cbArgs: any[]) => {
          try {
            const resp = cbArgs.length === 1 ? cbArgs[0] : cbArgs[1] ?? cbArgs[0];
            const q = resp?.question ?? null;
            setResumedQuestionId(q?.id ?? null);
          } catch {}
        });
      } catch {}
    };

    socket.on('admin_resume_state', onAdminResume);
    socket.on('lobby_update', onLobbyUpdate);
    socket.on('game_started', onGameStarted);
    socket.on('question_started', onQuestionStarted);
    socket.on('question_leaderboard', onQuestionLeaderboard);
    socket.on('game_leaderboard', onGameLeaderboard);
  socket.on('participant_submitted', onParticipantSubmitted);
    socket.on('connect', onConnect);
  socket.on('reconnect', onReconnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      try {
        socket.off('admin_resume_state', onAdminResume);
        socket.off('lobby_update', onLobbyUpdate);
        socket.off('game_started', onGameStarted);
        socket.off('question_started', onQuestionStarted);
        socket.off('question_leaderboard', onQuestionLeaderboard);
        socket.off('game_leaderboard', onGameLeaderboard);
  socket.off('participant_submitted', onParticipantSubmitted);
  socket.off('connect', onConnect);
  socket.off('reconnect', onReconnect);
        socket.off('disconnect', onDisconnect);
      } catch (err) {
        /* ignore */
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  useEffect(() => {
    if (questionLeaderboard.length > 0) {
      // show inline leaderboard under controls (don't switch to full-page leaderboard)
      setAdminAckLeaderboard(questionLeaderboard);
      // clear current question so End button is removed and next question can be started
      setCurrentQuestionIndex(null);
    }
  }, [questionLeaderboard]);

  useEffect(() => {
    if (gameLeaderboard.length > 0) {
      // show full game leaderboard for admin when server broadcasts it
      setAdminShowFullGameLeaderboard(true);
    }
  }, [gameLeaderboard]);

  // when returning to controls, clear any selected current question
  useEffect(() => {
    if (view === 'controls') {
      setCurrentQuestionIndex(null);
      setAdminAckLeaderboard(null);
      setAdminShowFullGameLeaderboard(false);
    }
  }, [view]);

  // full-page admin game leaderboard view
  if (adminShowFullGameLeaderboard && gameLeaderboard.length > 0) {
    return (
      <div className="min-h-screen bg-black">
        <LeaderboardView entries={gameLeaderboard} title="Final Results" isGameLeaderboard={true} />
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2">
          <button
            onClick={handleBackToControls}
            className="bg-[#31b1d8] hover:bg-[#2a9dbf] text-white font-semibold py-3 px-8 rounded-lg transition duration-200"
          >
            Back to Controls
          </button>
        </div>
      </div>
    );
  }

  const fetchQuestions = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`${apiUrl}/qa-api/questions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        const sorted = data.sort((a: Question, b: Question) => a.order - b.order);
        setQuestions(sorted);
        questionsRef.current = sorted;
        // if we already know current question id from server, reconcile now
        if (resumedQuestionId != null) {
          const idx = sorted.findIndex((q: Question) => q.id === resumedQuestionId);
          setCurrentQuestionIndex(idx >= 0 ? idx : null);
        }
      }
    } catch (err) {
      console.error('Failed to fetch questions:', err);
    }
  };

  const handleStartGame = async () => {
    setLoading(true);
    addLog('ui: Start Game clicked');
    if (socket) {
      socket.emit('admin_start_game', undefined, (ack: any) => {
        addLog('emit ack admin_start_game', ack);
        if (ack?.ok) {
          showToast('Start game acknowledged', 'success');
          setGameStatusLocal('active');
          setView('controls');
        } else {
          showToast('Start game failed', 'error');
        }
        setLoading(false);
      });
    } else {
      adminStartGame();
      setView('controls');
      setTimeout(() => setLoading(false), 1000);
    }
  };

  const handleStartQuestion = async (questionId: number) => {
    setLoading(true);
    const idx = questions.findIndex((q) => q.id === questionId);
    setCurrentQuestionIndex(idx >= 0 ? idx : null);
    addLog('ui: Start Question clicked', { questionId, index: idx });
    if (socket) {
      socket.emit('admin_start_question', { questionId }, (ack: any) => {
        addLog('emit ack admin_start_question', ack);
        if (ack?.ok) {
          showToast('Start question acknowledged', 'success');
          // server will emit question_started
        } else {
          showToast('Start question failed', 'error');
        }
        setLoading(false);
      });
    } else {
      adminStartQuestion(questionId);
      setTimeout(() => setLoading(false), 1000);
    }
  };

  const handleEndQuestion = async () => {
    if (currentQuestionIndex === null) return;
    const q = questions[currentQuestionIndex];
    if (!q) return;
    setLoading(true);
    addLog('ui: End Question clicked', { questionId: q.id, index: currentQuestionIndex });
    // emit and immediately clear the current question so Start buttons become active
    try {
      if (socket) {
        socket.emit('admin_end_question', { questionId: q.id }, (ack: any) => {
          addLog('emit ack admin_end_question', ack);
          if (ack?.leaderboard) {
            setAdminAckLeaderboard(ack.leaderboard);
          }
          // keep results inline under controls (don't switch to full leaderboard page)
          setCurrentQuestionIndex(null);
          setTimeout(() => setLoading(false), 500);
        });
      } else {
        // fallback to context method
        adminEndQuestion(q.id);
        setCurrentQuestionIndex(null);
        setTimeout(() => setLoading(false), 1000);
      }
    } catch (err) {
      console.error('end question emit error', err);
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    onLogout();
  };

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const handleOpenResetModal = () => {
    setResetInput('');
    setResetConfirmChecked(false);
    setShowResetModal(true);
  };

  const handleConfirmReset = async () => {
    const token = localStorage.getItem('adminToken');
    if (!token) {
      showToast('Unauthorized: admin access required', 'error');
      return;
    }
    // validate input again
    if (!(resetInput === 'DELETE' || resetInput === String(expectedSessionId)) || !resetConfirmChecked) {
      return;
    }

    setResetting(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const body: any = { gameSessionId: expectedSessionId };
      const res = await fetch(`${apiUrl}/qa-api/session/admin/reset-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 403) {
        showToast('Unauthorized: admin access required', 'error');
        setShowResetModal(false);
        setResetting(false);
        return;
      }

      if (!res.ok) {
        const errorText = await res.text();
        showToast(`Reset failed: ${errorText}`, 'error');
        setResetting(false);
        return;
      }

      const data = await res.json();
      if (data?.ok) {
        // clear admin-local displays
        setAdminAckLeaderboard(null);
        setAdminShowFullGameLeaderboard(false);
        setCurrentQuestionIndex(null);
        // clear socket-backed UI immediately
        setLobbyParticipantsLocal([]);
        setGameStatusLocal('idle');
        setGameLeaderboardLocal([]);
        setQuestionLeaderboardLocal([]);
        setParticipantLocal(null);
  // clear live submissions feed
  setLiveSubmissions([]);

        // reconnect socket as admin to refresh lobby/leaderboards from server
        try {
          connectAsAdmin(token);
        } catch (err) {
          console.warn('reconnect after reset failed', err);
        }

  const deleted = data.deleted ?? {};
  // show lobby and reset UI
  setView('lobby');
  showToast(`Reset successful. Deleted: answers=${deleted.answers ?? 0}, participants=${deleted.participants ?? 0}`, 'success');
      } else {
        showToast('Reset failed: unexpected response', 'error');
      }
    } catch (err: any) {
      showToast(`Reset error: ${err?.message ?? String(err)}`, 'error');
    } finally {
      setResetting(false);
      setShowResetModal(false);
    }
  };

  function handleBackToControls() {
    // clear admin-only flags and return to controls
    setAdminShowFullGameLeaderboard(false);
    setAdminAckLeaderboard(null);
    setCurrentQuestionIndex(null);
    setView('controls');
  }

  // Render everything inline; admin sees per-question leaderboards under controls.

  return (
    <div className="min-h-screen bg-black p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-3 items-center mb-8">
            <div className="flex items-center justify-start">
            <img src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`} alt="Quantum Logo" className="h-16 w-auto" />
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-bold text-[#31b1d8]">Admin Dashboard</h1>

            {/* Reset Session Modal */}
            {showResetModal ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                <div className="bg-gray-900 p-6 rounded-lg max-w-lg w-full border border-red-700">
                  <h3 className="text-xl font-bold text-white mb-2">Confirm reset of session data</h3>
                  <p className="text-gray-300 mb-4">This will permanently delete participants, answers and leaderboards for session {expectedSessionId}. Questions will be kept. This cannot be undone.</p>

                  <div className="mb-3">
                    <label className="text-sm text-gray-300 block mb-1">Type <code className="bg-gray-800 px-2 py-1 rounded">DELETE</code> or the session id ({expectedSessionId}) to confirm:</label>
                    <input
                      value={resetInput}
                      onChange={(e) => setResetInput(e.target.value)}
                      className="w-full p-2 bg-gray-800 border border-gray-700 rounded text-white"
                      placeholder={`Type DELETE or ${expectedSessionId}`}
                    />
                  </div>

                  <div className="mb-4 flex items-center">
                    <input id="confirmBox" type="checkbox" checked={resetConfirmChecked} onChange={(e) => setResetConfirmChecked(e.target.checked)} className="mr-2" />
                    <label htmlFor="confirmBox" className="text-gray-300">I understand this action cannot be undone.</label>
                  </div>

                  <div className="flex justify-end space-x-2">
                    <button onClick={() => setShowResetModal(false)} className="px-4 py-2 rounded bg-gray-700 text-white">Cancel</button>
                    <button
                      onClick={handleConfirmReset}
                      disabled={resetting || !(resetConfirmChecked && (resetInput === 'DELETE' || resetInput === String(expectedSessionId)))}
                      className={`px-4 py-2 rounded ${resetting ? 'bg-gray-600' : 'bg-red-600 hover:bg-red-700'} text-white disabled:opacity-50`}
                    >
                      {resetting ? 'Resetting...' : 'Confirm Reset'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Toast */}
            {toast ? (
              <div className={`fixed bottom-8 right-8 z-50 p-4 rounded ${toast.type === 'success' ? 'bg-green-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'}`}>
                <div className="text-white">{toast.message}</div>
              </div>
            ) : null}

            <div className="flex items-center justify-center space-x-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-400">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3">
            <button
              onClick={handleLogout}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
         
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          <div className="col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gray-900 rounded-lg p-6 border border-[#31b1d8]/20">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-300">Participants</h3>
                  <Users className="w-5 h-5 text-[#31b1d8]" />
                </div>
                <p className="text-4xl font-bold text-white">{lobbyParticipants.length}</p>
              </div>

              <div className="bg-gray-900 rounded-lg p-6 border border-[#31b1d8]/20">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-300">Game Status</h3>
                  <RefreshCw className="w-5 h-5 text-[#31b1d8]" />
                </div>
                <p className="text-2xl font-bold text-white capitalize">{gameStatus}</p>
              </div>

              <div className="bg-gray-900 rounded-lg p-6 border border-[#31b1d8]/20">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold text-gray-300">Questions</h3>
                  <Play className="w-5 h-5 text-[#31b1d8]" />
                </div>
                <p className="text-4xl font-bold text-white">{questions.length}</p>
              </div>
            </div>
          </div>

          {/* right column removed - live feed moved below */}
        </div>

        {view === 'lobby' && (
          <div className="bg-gray-900 rounded-lg p-6 border border-[#31b1d8]/20 mb-6">
            <h2 className="text-xl font-bold text-white mb-4">Lobby Participants</h2>
            {lobbyParticipants.length > 0 ? (
              <div className="space-y-2">
                {lobbyParticipants.map((participant, index) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between p-3 bg-gray-800 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-[#31b1d8] rounded-full flex items-center justify-center text-white font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-white font-medium">{participant.name}</p>
                        <p className="text-sm text-gray-400">{participant.phone}</p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-400">
                      Score: {participant.score}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-center py-8">No participants yet</p>
            )}

            <div className="mt-6">
              <button
                onClick={handleStartGame}
                disabled={loading || lobbyParticipants.length === 0 || gameStatus === 'active'}
                className="w-full bg-[#31b1d8] hover:bg-[#2a9dbf] text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-5 h-5" />
                <span>{gameStatus === 'active' ? 'Game Active' : 'Start Game'}</span>
              </button>
            </div>
          </div>
        )}

        {view === 'controls' && (
          <div className="bg-gray-900 rounded-lg p-6 border border-[#31b1d8]/20">
            <h2 className="text-xl font-bold text-white mb-4">Game Controls</h2>

            {gameStatus !== 'active' && (
              <div className="mb-4 text-sm text-yellow-300">Game is not active — controls are shown as a fallback.</div>
            )}

            <div className="space-y-3 mb-6">
              {questions.map((question) => (
                <div
                  key={question.id}
                  className="flex items-center justify-between p-4 bg-gray-800 rounded-lg"
                >
                  <div className="flex-1">
                    <p className="text-white font-medium">Question {question.order}</p>
                    <p className="text-sm text-gray-400 mt-1">{question.text}</p>
                  </div>
                  <button
                    onClick={() => handleStartQuestion(question.id)}
                    disabled={loading || currentQuestionIndex !== null}
                    className="ml-4 bg-[#31b1d8] hover:bg-[#2a9dbf] text-white font-semibold py-2 px-6 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                  >
                    <Play className="w-4 h-4" />
                    <span>Start</span>
                  </button>
                </div>
              ))}
            </div>
            {/* admin-only compact visual matching requested markup */}
            {(adminAckLeaderboard && adminAckLeaderboard.length > 0) || questionLeaderboard.length > 0 ? (
              <div className="mt-6">
                <div className="bg-gray-900 rounded-lg p-6 md:p-8 shadow-xl border border-[#31b1d8]/20">
                  <div className="text-center mb-8">
                    <h1 className="text-3xl md:text-4xl font-bold text-[#31b1d8] mb-2">Question Results</h1>
                    <p className="text-gray-400">Current Results</p>
                  </div>

                  <div className="space-y-3">
                    {(adminAckLeaderboard ?? questionLeaderboard).map((p: any, i: number) => {
                      const rank = p.rank ?? i + 1;
                      const name = p.participant?.name ?? p.name ?? 'Anonymous';
                      const timeText = p.answeredAt ? formatTime(p.answeredAt) : '';
                      const isCorrect = p.isCorrect ?? false;

                      const rankBg = rank === 1
                        ? 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/40 border-yellow-500/50'
                        : rank === 2
                        ? 'bg-gradient-to-r from-gray-800/40 to-gray-700/40 border-gray-500/50'
                        : rank === 3
                        ? 'bg-gradient-to-r from-amber-900/40 to-amber-800/40 border-amber-600/50'
                        : 'bg-gray-800/40 border-gray-700/50';

                      const RankIcon = rank === 1 ? Trophy : rank === 2 ? Medal : rank === 3 ? Award : null;

                      return (
                        <div
                          key={p.participantId ?? p.name ?? i}
                          className={`flex items-center justify-between p-4 md:p-5 rounded-lg border transition-all duration-200 ${rankBg} ${rank <= 3 ? 'transform hover:scale-105' : ''}`}
                        >
                          <div className="flex items-center space-x-4 flex-1 min-w-0">
                            <div className="flex-shrink-0">
                              {RankIcon ? <RankIcon className="w-6 h-6 text-yellow-400" /> : <div className="w-6 h-6 flex items-center justify-center font-bold text-gray-400">{rank}</div>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-lg truncate">{name}</p>
                              <div className="mt-1 text-sm text-gray-400">{timeText}</div>
                            </div>
                          </div>
 
                          <div className="ml-4 flex-shrink-0">
                            {isCorrect ? (
                              <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                                <span className="text-white text-xs font-bold">✓</span>
                              </div>
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                                <span className="text-white text-xs font-bold">✕</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 text-center">
                    <p className="text-gray-400 text-sm">Waiting for next question...</p>
                  </div>
                </div>
              </div>
            ) : null}

            {currentQuestionIndex !== null && (
              <button
                onClick={handleEndQuestion}
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center space-x-2 mb-3 disabled:opacity-50"
              >
                <StopCircle className="w-5 h-5" />
                <span>End Current Question</span>
              </button>
            )}

            <div className="mt-3">
              <button
                onClick={handleOpenResetModal}
                disabled={resetting}
                className="w-full bg-red-800 hover:bg-red-900 text-white font-semibold py-3 px-6 rounded-lg transition duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <span>Reset session (delete participants & leaderboards)</span>
              </button>
            </div>
            
          </div>
        )}

        {/* Full-width Live Submissions panel placed at bottom */}
        <div className="bg-gray-900 rounded-lg p-4 border border-[#31b1d8]/20 mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-300">Live Submissions</h3>
            <div aria-label="live submissions count" className="ml-2 inline-flex items-center justify-center px-2 py-1 rounded-full bg-[#31b1d8] text-black text-xs font-semibold">
              {liveSubmissions.length}
            </div>
          </div>
          {liveSubmissions.length === 0 ? (
            <div className="text-gray-400 text-sm">No submissions yet.</div>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {liveSubmissions.map((s, i) => (
                <li key={`${s.participant?.id ?? s.participant?.phone ?? i}-${i}`} className="flex items-start justify-between bg-gray-800 p-2 rounded">
                  <div className="min-w-0">
                    <div className="text-sm text-white font-medium truncate">{s.participant?.name ?? 'Unknown'}</div>
                    <div className="text-xs text-gray-400">{s.participant?.phone ?? ''} • Q#{s.questionId ?? '–'}</div>
                  </div>
                  <div className="ml-3 text-right">
                    <div className="text-sm text-[#31b1d8] font-mono">{s.selectedAnswer ?? ''}</div>
                    <div className={`text-xs ${s.isCorrect ? 'text-green-400' : 'text-red-400'}`}>{s.isCorrect ? 'Correct' : 'Incorrect'}</div>
                    <div className="text-xs text-gray-500">{s.answeredAt ? formatTime(s.answeredAt) : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
