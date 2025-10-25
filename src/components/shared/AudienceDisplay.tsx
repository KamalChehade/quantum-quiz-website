import React from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { LeaderboardView } from './LeaderboardView';
import { Loader2 } from 'lucide-react';

const AudienceDisplay: React.FC = () => {
  const { socket, currentQuestion, adminOnline, questionLeaderboard, gameLeaderboard, gameStatus, lobbyParticipants } = useSocket();

  // Live counting state
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [total, setTotal] = React.useState(0);
  const answersByParticipantRef = React.useRef<Map<string | number, string>>(new Map());

  // Make sure audience socket joins the session room to receive broadcasts
  React.useEffect(() => {
    if (!socket) return;
    const doJoin = () => { try { socket.emit('audience_join'); } catch {} };
    if ((socket as any).connected) doJoin();
    try { socket.on('connect', doJoin); } catch {}
    return () => { try { socket.off('connect', doJoin); } catch {} };
  }, [socket]);

  // Initialize or reset live counts when a question starts or resumes
  React.useEffect(() => {
    if (!socket) return;
    const onQuestionStarted = (_payload: any) => {
      answersByParticipantRef.current = new Map();
      setCounts({});
      setTotal(0);
    };
    const onQuestionResumed = (_payload: any) => {
      answersByParticipantRef.current = new Map();
      setCounts({});
      setTotal(0);
    };
    socket.on('question_started', onQuestionStarted);
    socket.on('resume_question', onQuestionResumed);
    socket.on('question_resumed', onQuestionResumed);
    return () => {
      try {
        socket.off('question_started', onQuestionStarted);
        socket.off('resume_question', onQuestionResumed);
        socket.off('question_resumed', onQuestionResumed);
      } catch {}
    };
  }, [socket]);

  // Try to fetch current tallies when a question is active (optional server support)
  React.useEffect(() => {
    if (!socket || !currentQuestion?.id) return;
    const qid = currentQuestion.id;
    const handleCounts = (resp: any) => {
      try {
        const c = resp?.counts || resp || {};
        if (c && typeof c === 'object') {
          // Normalize keys to strings
          const normalized: Record<string, number> = {};
          Object.keys(c).forEach((k) => { normalized[String(k)] = Number(c[k]) || 0; });
          answersByParticipantRef.current = new Map(); // we don't know per-participant mapping
          setCounts(normalized);
          const tot = Object.values(normalized).reduce((a, b) => a + b, 0);
          setTotal(tot);
        }
      } catch {}
    };
    try {
      socket.timeout(1500).emit('audience_get_counts', { questionId: qid }, (...args: any[]) => {
        const resp = args.length === 1 ? args[0] : args[1] ?? args[0];
        handleCounts(resp);
      });
    } catch {}
    try {
      socket.timeout(1500).emit('get_current_counts', { questionId: qid }, (...args: any[]) => {
        const resp = args.length === 1 ? args[0] : args[1] ?? args[0];
        handleCounts(resp);
      });
    } catch {}
  }, [socket, currentQuestion?.id]);

  // Live accumulation with replacement by participant
  React.useEffect(() => {
    if (!socket) return;
    const onSubmitted = (payload: any) => {
      const qid = payload?.questionId ?? payload?.question_id;
      const sel = payload?.selectedAnswer ?? payload?.selected_answer ?? payload?.selected;
      if (!qid || !sel) return;
      if (currentQuestion && Number(qid) !== Number(currentQuestion.id)) return;

      const participantKey = payload?.participant?.id ?? payload?.participantId ?? null;
      if (participantKey != null) {
        const prev = answersByParticipantRef.current.get(participantKey);
        if (prev === sel) return; // no change
        setCounts((prevCounts) => {
          const next = { ...prevCounts };
          if (prev && next[prev] != null) next[prev] = Math.max(0, (next[prev] || 0) - 1);
          next[sel] = (next[sel] || 0) + 1;
          return next;
        });
        if (!prev) setTotal((t) => t + 1);
        answersByParticipantRef.current.set(participantKey, sel);
      } else {
        // No participant id provided; best-effort increment
        setCounts((prevCounts) => ({ ...prevCounts, [sel]: (prevCounts[sel] || 0) + 1 }));
        setTotal((t) => t + 1);
      }
    };

    socket.on('participant_submitted', onSubmitted);
    return () => { try { socket.off('participant_submitted', onSubmitted); } catch {} };
  }, [socket, currentQuestion?.id]);

  // If the entire game ended, show final leaderboard
  if (gameLeaderboard && gameLeaderboard.length > 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-5xl">
          <div className="flex justify-center mb-6">
            <img src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`} alt="Quantum Logo" className="h-14 w-auto" />
          </div>
          <LeaderboardView entries={gameLeaderboard} title="Final Results" isGameLeaderboard={true} />
        </div>
      </div>
    );
  }

  // If question ended, show per-question leaderboard
  if (questionLeaderboard && questionLeaderboard.length > 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-5xl">
          <div className="flex justify-center mb-6">
            <img src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`} alt="Quantum Logo" className="h-14 w-auto" />
          </div>
          <LeaderboardView entries={questionLeaderboard} title="Question Results" isGameLeaderboard={false} />
        </div>
      </div>
    );
  }

  // Otherwise, waiting states
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center p-4">
      <div className="w-full max-w-5xl">
        <div className="flex justify-center mb-8">
          <img src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`} alt="Quantum Logo" className="h-14 w-auto" />
        </div>

        {!adminOnline && (
          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-300 text-sm text-center">
            Waiting for admin… Stay tuned.
          </div>
        )}

        <div className="bg-gray-900 rounded-lg p-10 border border-[#31b1d8]/20">
          {currentQuestion || gameStatus === 'active' ? (
            <>
              {currentQuestion && (
                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#31b1d8]/20 rounded-full mb-4">
                    <span className="text-[#31b1d8] font-semibold">Question {currentQuestion.order}</span>
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold text-white leading-relaxed">
                    {currentQuestion.text}
                  </h2>
                </div>
              )}

              {/* Live bars */}
              {currentQuestion ? (
                <div className="space-y-3">
                  {currentQuestion.choices.map((c) => {
                    const count = counts[c.key] || 0;
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={c.key} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center font-bold text-gray-300">{c.key}</div>
                            <div className="font-medium text-gray-100">{c.text}</div>
                          </div>
                          <div className="text-sm text-gray-400">{count} {count === 1 ? 'vote' : 'votes'} · {pct}%</div>
                        </div>
                        <div className="w-full h-3 bg-gray-700 rounded overflow-hidden">
                          <div className="h-3 bg-[#31b1d8]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-10">
                  <Loader2 className="w-14 h-14 text-[#31b1d8] animate-spin mb-4 mx-auto" />
                  <p className="text-gray-300 text-lg">Waiting for answers…</p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between text-sm text-gray-400">
                <div>
                  Total submissions: <span className="text-gray-200 font-semibold">{total}</span>
                  {' '} / {' '}
                  <span className="text-gray-200 font-semibold">{Array.isArray(lobbyParticipants) ? lobbyParticipants.length : 0}</span>
                </div>
                <div className="italic">Live</div>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <div className="inline-block px-4 py-2 bg-[#31b1d8]/20 rounded-full mb-4 text-[#31b1d8]">Audience View</div>
              <p className="text-gray-300 text-lg">Waiting for the next question…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudienceDisplay;
