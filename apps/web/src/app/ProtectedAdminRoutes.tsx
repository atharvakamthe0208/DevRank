import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';

export function ProtectedAdminRoutes() {
  const { state, error, refresh, signOut } = useAuth();
  const location = useLocation();

  if (state === 'loading') {
    return <main className="auth-state-page" role="status">Restoring your secure session…</main>;
  }

  if (state === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (state === 'admin') {
    return <Outlet />;
  }

  if (state === 'approved') {
    return <Navigate to="/dashboard" replace />;
  }

  if (state === 'pending' || state === 'rejected' || state === 'unconfirmed') {
    return <Navigate to="/access-pending" replace />;
  }

  if (state === 'profile-missing') {
    return (
      <main className="auth-state-page">
        <h1>Recruiter profile not found</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void refresh()}>
          Retry profile check
        </button>
        <button className="secondary-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main className="auth-state-page">
      <h1>Can’t verify administrator access</h1>
      <p>{error || 'Administrator access is required.'}</p>
      <button className="primary-button" onClick={() => void refresh()}>
        Try again
      </button>
    </main>
  );
}
