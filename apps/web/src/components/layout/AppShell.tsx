import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../../features/auth/AuthProvider';

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: '⌂' },
  { to: '/dashboard/candidates', label: 'Candidates', icon: '♙' },
  { to: '/evaluations', label: 'Evaluations', icon: '◉' },
  { to: '/dashboard/reports', label: 'Reports', icon: '▤' },
];

export function AppShell() {
  const location = useLocation();
  const { profile, signOut } = useAuth();
  const [signOutError, setSignOutError] = useState('');
  const pageTitle = location.pathname === '/candidates/new'
    ? 'Add candidate'
    : location.pathname.startsWith('/candidates/')
    ? 'Candidate profile'
    : location.pathname.includes('evaluations') || location.pathname.endsWith('/evaluate')
      ? 'Evaluation'
      : location.pathname.includes('candidates')
      ? 'Candidates'
      : location.pathname.includes('reports')
        ? 'Reports'
        : location.pathname.includes('evaluations')
          ? 'Evaluations'
        : 'Overview';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/dashboard" className="brand"><span className="brand-mark">d.</span><span>devrank<span className="brand-period">.</span></span></NavLink>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => <NavLink key={item.to} to={item.to} end={item.to === '/dashboard'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><span className="nav-icon">{item.icon}</span>{item.label}</NavLink>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade-card"><span className="upgrade-spark">✦</span><strong>Better hiring starts here.</strong><p>Make confident decisions with candidate insights.</p><button type="button" className="text-button">Explore DevRank <span aria-hidden="true">↗</span></button></div>
          <div className="user-mini"><div className="avatar avatar-user">{(profile?.display_name ?? 'R').split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</div><div className="user-copy"><strong>{profile?.display_name || 'Recruiter'}</strong><span>Recruiter</span></div><button type="button" className="logout-button" onClick={() => { setSignOutError(''); void signOut().catch(() => setSignOutError('Could not sign out. Check your connection and try again.')); }}>Log out</button></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">d.</span> devrank<span className="brand-period">.</span></div><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div><div className="topbar-actions"><span className="data-chip"><i /> Recruiter workspace</span><button className="logout-button mobile-logout" type="button" onClick={() => { void signOut().catch(() => setSignOutError('Could not sign out. Try again.')); }}>Log out</button><div className="avatar avatar-user top-avatar">{(profile?.display_name ?? 'R').split(/\s+/).map((part) => part[0]).slice(0,2).join('').toUpperCase()}</div></div></header>
        <main className="page-content">{signOutError && <p className="form-feedback form-feedback-error" role="alert">{signOutError}</p>}<Outlet /></main>
      </div>
    </div>
  );
}
