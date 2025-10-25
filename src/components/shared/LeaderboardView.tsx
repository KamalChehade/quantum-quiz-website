import React from 'react';
import { Trophy, Medal, Award } from 'lucide-react';

interface LeaderboardEntry {
  // keep old shape but allow optional for defensive rendering
  rank?: number | null;
  // some payloads use `participant` with `name`, others may send `name` directly
  participant?: {
    name?: string | null;
  };
  // alternative flat name property (compatible with question_leaderboard contract)
  name?: string | null;
  answeredAt?: string;
  // some payloads use `score` field per-question
  score?: number;
  totalScore?: number;
  scoreForQuestion?: number;
  isCorrect?: boolean;
  correctAnswersCount?: number;
  accuracyPercent?: number;
}

interface LeaderboardViewProps {
  entries: LeaderboardEntry[];
  title: string;
  isGameLeaderboard?: boolean;
  currentParticipantId?: number;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  entries,
  title,
  isGameLeaderboard = false,
  
}) => {
  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-6 h-6 text-yellow-400" />;
      case 2:
        return <Medal className="w-6 h-6 text-gray-400" />;
      case 3:
        return <Award className="w-6 h-6 text-amber-600" />;
      default:
        return (
          <div className="w-6 h-6 flex items-center justify-center font-bold text-gray-400">
            {rank}
          </div>
        );
    }
  };

  const getRankBgColor = (rank: number) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-900/40 to-yellow-800/40 border-yellow-500/50';
      case 2:
        return 'bg-gradient-to-r from-gray-800/40 to-gray-700/40 border-gray-500/50';
      case 3:
        return 'bg-gradient-to-r from-amber-900/40 to-amber-800/40 border-amber-600/50';
      default:
        return 'bg-gray-800/40 border-gray-700/50';
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="flex justify-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`}
            alt="Quantum Logo"
            className="h-20 w-auto"
          />
        </div>

        <div className="bg-gray-900 rounded-lg p-6 md:p-8 shadow-xl border border-[#31b1d8]/20">
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-[#31b1d8] mb-2">
              {title}
            </h1>
            <p className="text-gray-400">
              {isGameLeaderboard ? 'Final Rankings' : 'Current Results'}
            </p>
          </div>

          <div className="space-y-3">
            {(!entries || entries.length === 0) && (
              <div className="text-gray-400">No leaderboard entries yet.</div>
            )}

            {entries.map((entry, idx) => {
              // normalize values and provide safe defaults
              const rank = entry.rank ?? null;
              const displayRank = rank === null ? '—' : rank;
              const name = entry.participant?.name ?? entry.name ?? 'Anonymous';
              // score is available but not shown in the current UI; keep rendering minimal

              const formatTime = (iso?: string) => {
                if (!iso) return '';
                const d = new Date(iso);
                const hours = d.getHours();
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                const ampm = hours >= 12 ? 'PM' : 'AM';
                const hour12 = hours % 12 === 0 ? 12 : hours % 12;
                return `${hour12}:${mm}:${ss} ${ampm}`;
              };

              const timeText = formatTime(entry.answeredAt);
              const isCorrect = entry.isCorrect;

              return (
                <div
                  key={entry.name ?? entry.participant?.name ?? `${displayRank}-${idx}`}
                  className={`
                    flex items-center justify-between p-4 md:p-5 rounded-lg border transition-all duration-200
                    ${getRankBgColor(typeof rank === 'number' ? rank : 999)}
                    ${typeof rank === 'number' && rank <= 3 ? 'transform hover:scale-105' : ''}
                  `}
                >
                  <div className="flex items-center space-x-4 flex-1 min-w-0">
                    <div className="flex-shrink-0">
                      {getRankIcon(typeof rank === 'number' ? rank : 999)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-lg truncate">
                        {name}
                      </p>
                      {isGameLeaderboard && (
                        <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-400">
                          <span>
                            {entry.correctAnswersCount ?? 0} correct
                          </span>
                          <span>
                            {(entry.accuracyPercent ?? 0).toFixed(1)}% accuracy
                          </span>
                        </div>
                      )}
                      {!isGameLeaderboard && timeText && (
                        <div className="mt-1 text-sm text-gray-400">{timeText}</div>
                      )}
                    </div>
                  </div>

                  

                  {!isGameLeaderboard && isCorrect !== undefined && (
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
                  )}
                </div>
              );
            })}
          </div>

          {!isGameLeaderboard && (
            <div className="mt-6 text-center">
              <p className="text-gray-400 text-sm">
                Waiting for next question...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
