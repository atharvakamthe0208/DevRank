import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthProvider';
import { AuthLoadingScreen } from '../features/auth/AuthLoadingScreen';
import { PublicLandingPage } from '../features/public/PublicLandingPage';

export function ProtectedRecruiterRoutes() {
  const { state, error, refresh, signOut } = useAuth();
  const location = useLocation();

  if (state === 'loading') return <AuthLoadingScreen message="Verifying recruiter access…"/>;
  if (state === 'signed-out') {
    if (location.pathname === '/') return <PublicLandingPage />;
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (state === 'admin') return <Navigate to="/admin/recruiters" replace />;
  if (state === 'pending' || state === 'rejected' || state === 'unconfirmed') return <Navigate to="/access-pending" replace />;

  if (state === 'profile-missing') {
    return <main className="auth-state-page"><h1>Recruiter profile not found</h1><p>{error}</p><button className="primary-button" onClick={() => void refresh()}>Retry profile check</button><button className="secondary-button" onClick={() => void signOut()}>Sign out</button></main>;
  }
  if (state === 'error') {
    return <main className="auth-state-page"><h1>Can’t verify recruiter access</h1><p>{error}</p><button className="primary-button" onClick={() => void refresh()}>Try again</button></main>;
  }
  return <Outlet />;
}
