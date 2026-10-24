
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { CandidateDetailsPage } from '../features/candidates/CandidateDetailsPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AccessPendingPage, AuthCallbackPage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from '../features/auth/AuthPages';
import { useAuth } from '../features/auth/AuthProvider';
import { AdminRecruitersPage } from '../features/admin/AdminRecruitersPage';
import { AdminRecruiterDetailsPage } from '../features/admin/AdminRecruiterDetailsPage';
import { CandidateListPage } from '../features/candidates/CandidateListPage';
import { AddCandidatePage } from '../features/candidates/AddCandidatePage';
import { EvaluationPage } from '../features/evaluation/EvaluationPage';
import { InsightsPage } from '../features/insights/InsightsPage';
import { EvaluationCreatePage } from '../features/evaluations/EvaluationCreatePage';
import { EvaluationResultPage } from '../features/evaluations/EvaluationResultPage';
import { ResumeScreeningPage } from '../features/screening/ResumeScreeningPage';
import { AiAnalysisReportPage } from '../features/evaluation/AiAnalysisReportPage';
import { AuthLoadingScreen } from '../features/auth/AuthLoadingScreen';
import { RecruiterProfilePage } from '../features/profile/RecruiterProfilePage';
import { UnifiedCandidateReportPage } from '../features/evaluations/UnifiedCandidateReportPage';

function ProtectedRecruiterRoutes() {
  const { state, error, refresh, signOut } = useAuth();
  const location = useLocation();

  if (state === 'loading') {
    return <AuthLoadingScreen message="Verifying recruiter access…"/>;
  }

  if (state === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (state === 'admin') {
    return <Navigate to="/admin/recruiters" replace />;
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

  if (state === 'error') {
    return (
      <main className="auth-state-page">
        <h1>Can’t verify recruiter access</h1>
        <p>{error}</p>
        <button className="primary-button" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  }

  return <Outlet />;
}

function ProtectedAdminRoutes() {
  const { state, error, refresh, signOut } = useAuth();
  const location = useLocation();

  if (state === 'loading') {
    return <AuthLoadingScreen message="Verifying administrator access…"/>;
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

function NotFoundPage() {
  return (
    <div className="not-found-card">
      <span className="not-found-mark">404</span>
      <h1>Page not found</h1>
      <p>We couldn’t find the page you were looking for.</p>
      <a className="primary-button link-button" href="/dashboard">
        Back to overview
      </a>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/access-pending', element: <AccessPendingPage /> },

  {
    element: <ProtectedAdminRoutes />,
    children: [
      {
        path: '/admin/recruiters',
        element: <AdminRecruitersPage />,
      },
      {
        path: '/admin/recruiters/:recruiterId',
        element: <AdminRecruiterDetailsPage />,
      },
    ],
  },

  {
    element: <ProtectedRecruiterRoutes />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'profile', element: <RecruiterProfilePage /> },
          { path: 'dashboard/candidates', element: <CandidateListPage /> },
          { path: 'dashboard/reports', element: <InsightsPage /> },
          { path: 'screening', element: <ResumeScreeningPage /> },
          { path: 'evaluations', element: <EvaluationPage /> },
          { path: 'evaluations/:evaluationId', element: <EvaluationResultPage /> },
          { path: 'evaluations/:evaluationId/analysis', element: <AiAnalysisReportPage /> },
          { path: 'candidates/new', element: <AddCandidatePage /> },
          { path: 'candidates/:id', element: <CandidateDetailsPage /> },
          { path: 'candidates/:id/report', element: <UnifiedCandidateReportPage /> },
          { path: 'candidates/:id/evaluate', element: <EvaluationCreatePage /> },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
]);
