import React, { useEffect, useState } from 'react';
import { useSocket } from '../../contexts/SocketContext';

export const PlayerJoin: React.FC = () => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const { joinQuiz, adminOnline } = useSocket();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminOnline) {
      setError('Waiting for an admin to start the quiz.');
      return;
    }

    if (name.trim() && phone.trim()) {
      setLoading(true);
      joinQuiz(name, phone).then((ack) => {
        setLoading(false);
        const ok = ack?.ok ?? true;
        if (!ok) {
          // server denied join (likely no admin connected)
          // show a toast-like inline message
          setError('Please wait for an admin to start the quiz.');
        }
      }).catch(() => {
        setLoading(false);
        setError('Join failed — please try again.');
      });
    }
  };

  // transient toast when admin presence changes
  useEffect(() => {
    if (adminOnline) {
      setToast('Admin connected — you can now join the quiz');
    } else {
      setToast('Admin disconnected — waiting for admin');
    }
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [adminOnline]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <img
            src={`${import.meta.env.BASE_URL}QuantumLogo (1).png`}
            alt="Quantum Logo"
            className="h-24 w-auto"
          />
        </div>

        <div className="bg-gray-900 rounded-lg p-8 shadow-xl border border-[#31b1d8]/20">
          <h1 className="text-3xl font-bold text-[#31b1d8] mb-2 text-center">
            Join Quantum Quiz
          </h1>
          <p className="text-gray-400 text-center mb-6">
            Enter your details to participate
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Admin presence banner */}
            {!adminOnline && (
              <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-300 text-sm">
                Waiting for an admin to connect — you will be able to join when they are online.
              </div>
            )}
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#31b1d8] focus:ring-1 focus:ring-[#31b1d8] transition"
                placeholder="Enter your name"
                required
                disabled={!adminOnline}
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-300 mb-2">
                Phone Number
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#31b1d8] focus:ring-1 focus:ring-[#31b1d8] transition"
                placeholder="Enter your phone number"
                required
                disabled={!adminOnline}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !adminOnline}
              className="w-full bg-[#31b1d8] hover:bg-[#2a9dbf] text-white font-semibold py-3 px-6 rounded-lg transition duration-200 transform hover:scale-105 disabled:opacity-50"
            >
              {loading ? 'Joining...' : 'Join Quiz'}
            </button>
          </form>
          {/* transient toast for admin connect/disconnect */}
          {toast && (
            <div className="mt-4 text-center text-sm text-gray-300">{toast}</div>
          )}
        </div>
      </div>
    </div>
  );
};
