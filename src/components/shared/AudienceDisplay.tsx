import React from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { LeaderboardView } from './LeaderboardView';
import { Loader2 } from 'lucide-react';

const AudienceDisplay: React.FC = () => {
  const { socket, currentQuestion, adminOnline, questionLeaderboard, gameLeaderboard } = useSocket();

  // Make sure audience socket joins the session room to receive broadcasts
  React.useEffect(() => {
    if (!socket) return;
    const doJoin = () => { try { socket.emit('audience_join'); } catch {} };
    if ((socket as any).connected) doJoin();
    try { socket.on('connect', doJoin); } catch {}
    return () => { try { socket.off('connect', doJoin); } catch {} };
  }, [socket]);

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

        <div className="bg-gray-900 rounded-lg p-10 border border-[#31b1d8]/20 text-center">
          {currentQuestion ? (
            <>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#31b1d8]/20 rounded-full mb-4">
                <span className="text-[#31b1d8] font-semibold">Question {currentQuestion.order}</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-6 leading-relaxed">
                {currentQuestion.text}
              </h2>
              <div className="flex flex-col items-center justify-center py-10">
                <Loader2 className="w-14 h-14 text-[#31b1d8] animate-spin mb-4" />
                <p className="text-gray-300 text-lg">Waiting for answers…</p>
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
