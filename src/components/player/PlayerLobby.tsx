import React from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { Loader2, WifiOff } from 'lucide-react';

export const PlayerLobby: React.FC = () => {
  const { participant, isConnected, adminOnline, currentQuestion } = useSocket();
  React.useEffect(() => {
    console.log('[PlayerLobby] State:', {
      participant: participant?.id,
      isConnected,
      adminOnline,
      currentQuestion: currentQuestion?.id,
      hasQuestion: !!currentQuestion
    });
  }, [participant, isConnected, adminOnline, currentQuestion]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`}
            alt="Quantum Logo"
            className="h-24 w-auto"
          />
        </div>

        <div className="relative bg-gray-900 rounded-lg p-8 shadow-xl border border-[#31b1d8]/20">
          {/* Waiting for admin overlay (do NOT disconnect socket) */}
          {!adminOnline && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/70">
              <div className="text-center px-6 py-5 rounded-lg border border-yellow-500/40 bg-yellow-500/10">
                <div className="flex items-center justify-center gap-2 text-yellow-300 mb-2">
                  <WifiOff className="w-5 h-5" />
                  <span className="font-semibold">Waiting for admin…</span>
                </div>
                <p className="text-yellow-200/90 text-sm">
                  Stay on this screen. You'll automatically get the next question when the admin returns.
                </p>
              </div>
            </div>
          )}
          <div className="flex justify-center mb-6">
            <Loader2 className="w-16 h-16 text-[#31b1d8] animate-spin" />
          </div>

          <h1 className="text-3xl font-bold text-[#31b1d8] mb-4">
            Welcome, {participant?.name}!
          </h1>

          <p className="text-gray-300 text-lg mb-2">
            {adminOnline ? 'Waiting for the question to start…' : 'Admin is temporarily offline.'}
          </p>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <div className="flex items-center justify-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-400">
                {isConnected ? 'Connected' : 'Connecting…'}
              </span>
              <span className="mx-2 text-gray-600">•</span>
              <div className={`w-2 h-2 rounded-full ${adminOnline ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-sm text-gray-400">
                {adminOnline ? 'Admin online' : 'Admin offline'}
              </span>
            </div>
          </div>
        </div>

        <p className="text-gray-500 text-sm mt-6">
          The admin will start the game shortly.
        </p>
      </div>
    </div>
  );
};