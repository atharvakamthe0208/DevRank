import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { CandidateDetailsPage } from '../features/candidates/CandidateDetailsPage';
import { AddCandidatePage } from '../features/candidates/AddCandidatePage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LoginPage } from '../features/auth/LoginPage';

function SimplePage({ title }: { title: string }) {
  return <section className="placeholder-page"><span className="placeholder-mark">✦</span><h1>{title}</h1><p>This screen is part of the DevRank workspace. Product data will appear here as the experience grows.</p><small>Demo workspace · Mock experience</small></section>;
}

function NotFoundPage() {
  return <div className="not-found-card"><span className="not-found-mark">404</span><h1>Page not found</h1><p>We couldn’t find the page you were looking for.</p><NavigateButton /></div>;
}

function NavigateButton() {
  return <a className="primary-button link-button" href="/dashboard">Back to overview</a>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <AppShell />, children: [
    { index: true, element: <Navigate to="/dashboard" replace /> },
    { path: 'dashboard', element: <DashboardPage /> },
    { path: 'dashboard/candidates/new', element: <AddCandidatePage /> },
    { path: 'dashboard/candidates', element: <SimplePage title="All candidates" /> },
    { path: 'dashboard/reports', element: <SimplePage title="Reports" /> },
    { path: 'candidates/:id', element: <CandidateDetailsPage /> },
  ] },
  { path: '*', element: <NotFoundPage /> },
]);
