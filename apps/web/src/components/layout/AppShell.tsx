import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';
import devrankMark from '../../assets/devrank-mark.svg';
import { WorkspaceBreadcrumbContext } from './WorkspaceBreadcrumbContext';
import { workspaceBreadcrumbs } from './workspace-breadcrumbs';
import './workspace-breadcrumbs.css';

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: '⌂' },
  { to: '/dashboard/candidates', label: 'Candidates', icon: '♙' },
  { to: '/evaluations', label: 'Evaluations', icon: '◉' },
  { to: '/dashboard/reports', label: 'Insights', icon: '▤' },
  { to: '/screening', label: 'Resume Screening', icon: '▧' },
];

export function AppShell() {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState('');
  const [breadcrumbLabels, setBreadcrumbLabels] = useState<{ pathname: string; candidateName?: string; evaluationName?: string } | null>(null);
  const routeState = location.state as { candidateListReturn?: { path?: unknown; search?: unknown; scrollY?: unknown } } | null;
  const returnPath = routeState?.candidateListReturn?.path;
  const candidateListPath = typeof returnPath === 'string' && /^\/dashboard\/candidates(?:\?.*)?$/.test(returnPath) ? returnPath : undefined;
  const labels = { ...(breadcrumbLabels?.pathname === location.pathname ? breadcrumbLabels : {}), candidateListPath };
  const breadcrumbs = workspaceBreadcrumbs(location.pathname, labels);
  const candidateListState = { candidateListSearch: typeof routeState?.candidateListReturn?.search === 'string' ? routeState.candidateListReturn.search : '', candidateListRestoreScroll: typeof routeState?.candidateListReturn?.scrollY === 'number' ? routeState.candidateListReturn.scrollY : undefined };

  return (
    <div className={`app-shell${location.pathname === '/dashboard' || /^\/evaluations\/[^/]+\/analysis$/.test(location.pathname) ? ' refined-workspace' : ''}`}>
      <aside className="sidebar">
        <NavLink to="/dashboard" className="brand"><img className="brand-mark-img" src={devrankMark} alt=""/><span>devrank<span className="brand-period">.</span></span></NavLink>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const isCandidatePage = item.to === '/dashboard/candidates' && location.pathname.startsWith('/candidates/');
            return <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'} aria-label={item.label} title={item.label} aria-current={isCandidatePage ? 'page' : undefined} className={({ isActive }) => `nav-link${isActive || isCandidatePage ? ' active' : ''}`}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span></NavLink>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-mini"><NavLink to="/profile" aria-label={'View profile for ' + (profile?.display_name || 'Recruiter')} className={({ isActive }) => 'user-profile-link' + (isActive ? ' active' : '')}><div className="avatar avatar-user" aria-hidden="true">{(profile?.display_name ?? 'R').split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</div><span className="user-copy"><strong>{profile?.display_name || 'Recruiter'}</strong><span>Recruiter</span></span></NavLink><button type="button" className="logout-button" onClick={() => { setSignOutError(''); void signOut().catch(() => setSignOutError('Could not sign out. Check your connection and try again.')); }}>Log out</button></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar"><div className="mobile-brand"><img className="mobile-brand-img" src={devrankMark} alt=""/> devrank<span className="brand-period">.</span></div><nav className="breadcrumb" aria-label="Breadcrumb"><ol className="breadcrumb-list">{breadcrumbs.map((crumb, index) => <li key={`${crumb.label}-${index}`}>{index > 0 && <span className="crumb-slash" aria-hidden="true">/</span>}{crumb.to ? <Link to={crumb.to} state={crumb.label === 'Candidates' ? candidateListState : undefined}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</li>)}</ol></nav><div className="topbar-actions"><span className="data-chip"><i /> Recruiter workspace</span><button className="logout-button mobile-logout" type="button" onClick={() => { void signOut().catch(() => setSignOutError('Could not sign out. Try again.')); }}>Log out</button><NavLink to="/profile" aria-label={'View profile for ' + (profile?.display_name || 'Recruiter')} className={({ isActive }) => 'avatar avatar-user top-avatar profile-avatar-link' + (isActive ? ' active' : '')}><span aria-hidden="true">{(profile?.display_name ?? 'R').split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</span></NavLink></div></header>
        <main className="page-content">{signOutError && <p className="form-feedback form-feedback-error" role="alert">{signOutError}</p>}<WorkspaceBreadcrumbContext.Provider value={setBreadcrumbLabels}><Outlet /></WorkspaceBreadcrumbContext.Provider></main>
      </div>
    </div>
  );
}
