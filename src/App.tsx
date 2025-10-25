import { useState, useEffect } from 'react';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { PlayerJoin } from './components/player/PlayerJoin';
import { PlayerLobby } from './components/player/PlayerLobby';
import { QuestionView } from './components/player/QuestionView';
import { LeaderboardView } from './components/shared/LeaderboardView';
import AudienceDisplay from './components/shared/AudienceDisplay';
import { AdminLogin } from './components/admin/AdminLogin';
import { AdminDashboard } from './components/admin/AdminDashboard';
import SocketDebug from './components/Debug/SocketDebug';

type UserRole = 'player' | 'admin' | null;

function AppContent() {
  const [role, setRole] = useState<UserRole>(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  const {
    participant,
    currentQuestion,
    questionLeaderboard,
    gameLeaderboard,
    gameStatus,
    connectAsAdmin,
  } = useSocket();

  useEffect(() => {
    const savedParticipant = localStorage.getItem('participant');
    if (savedParticipant && !role) {
      setRole('player');
    }

    const adminToken = localStorage.getItem('adminToken');
    if (adminToken && !role) {
      setRole('admin');
      setIsAdminAuthenticated(true);
      connectAsAdmin(adminToken);
    }

    const path = window.location.pathname;
    // handle both root-hosted and base-hosted deployments (Vite's BASE_URL)
    const base = (import.meta.env.BASE_URL as string) ?? '/';
    const adminPath = base.endsWith('/') ? `${base}admin`.replace('//', '/') : `${base}/admin`;
    const audiencePath = base.endsWith('/') ? `${base}audience`.replace('//', '/') : `${base}/audience`;
    if (!role && (path === '/admin' || path === adminPath || path.endsWith('/admin'))) {
      setRole('admin');
    }
    // Simple route: /audience shows the audience display regardless of role
    if (path === '/audience' || path === audiencePath || path.endsWith('/audience')) {
      // Use a sentinel role to short-circuit into AudienceDisplay render below
      setRole(null);
      (window as any).__showAudience = true;
    }
  }, [role, connectAsAdmin]);

  // Route shortcut for audience view
  if ((window as any).__showAudience) {
    return <AudienceDisplay />;
  }

  const handleAdminLogin = (token: string) => {
    setIsAdminAuthenticated(true);
    connectAsAdmin(token);
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setRole(null);
    localStorage.removeItem('adminToken');
  };

  if (role === 'admin') {
    if (!isAdminAuthenticated) {
      return <AdminLogin onLogin={handleAdminLogin} />;
    }
    return (
      <>
        <AdminDashboard onLogout={handleAdminLogout} />
        <SocketDebug />
      </>
    );
  }

  if (!participant) {
    return (
      <>
        <PlayerJoin />
        <SocketDebug />
      </>
    );
  }

  if (gameLeaderboard.length > 0) {
    return (
      <LeaderboardView
        entries={gameLeaderboard}
        title="Final Results"
        isGameLeaderboard={true}
        currentParticipantId={participant.id}
      />
    );
  }

  if (questionLeaderboard.length > 0) {
    return (
      <LeaderboardView
        entries={questionLeaderboard}
        title="Question Results"
        isGameLeaderboard={false}
        currentParticipantId={participant.id}
      />
    );
  }

  if (currentQuestion) {
    return (
      <>
        <QuestionView />
        <SocketDebug />
      </>
    );
  }

  if (gameStatus === 'active' || gameStatus === 'idle') {
    return <PlayerLobby />;
  }

  return <PlayerLobby />;
}

function App() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}

export default App;
