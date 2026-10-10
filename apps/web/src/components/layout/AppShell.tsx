import { NavLink, Outlet, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/dashboard', label: 'Overview', icon: '⌂' },
  { to: '/dashboard/candidates', label: 'Candidates', icon: '♙' },
  { to: '/dashboard/reports', label: 'Reports', icon: '▤' },
];

export function AppShell() {
  const location = useLocation();
  const pageTitle = location.pathname.startsWith('/candidates/')
    ? 'Candidate profile'
    : location.pathname.endsWith('/candidates/new')
      ? 'Add candidate'
    : location.pathname.includes('candidates')
      ? 'Candidates'
      : location.pathname.includes('reports')
        ? 'Reports'
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
          <div className="user-mini"><div className="avatar avatar-user">AP</div><div className="user-copy"><strong>Aryan Panchal</strong><span>Admin</span></div><span className="more-dots">···</span></div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">d.</span> devrank<span className="brand-period">.</span></div><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div><div className="topbar-actions"><span className="data-chip"><i /> Demo workspace</span><button className="icon-button notification-button" aria-label="Notifications">♧<i /></button><div className="avatar avatar-user top-avatar">AP</div></div></header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  );
}
