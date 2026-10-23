import './workspace-skeleton.css';

type WorkspaceSkeletonVariant = 'dashboard' | 'profile' | 'candidates' | 'screening' | 'evaluations' | 'insights' | 'detail' | 'history' | 'ranking';
const labels: Record<WorkspaceSkeletonVariant, string> = { dashboard: 'workspace overview', profile: 'recruiter profile', candidates: 'candidate list', screening: 'resume screening session', evaluations: 'evaluation setup', insights: 'recruiter insights', detail: 'workspace details', history: 'evaluation history', ranking: 'candidate ranking' };
function Block({ className = '' }: { className?: string }) { return <span className={`workspace-skeleton-block ${className}`} aria-hidden="true"/>; }
function Rows({ count = 4 }: { count?: number }) { return <div className="workspace-skeleton-rows" aria-hidden="true">{Array.from({ length: count }, (_, i) => <div className="workspace-skeleton-row" key={i}><Block className="is-avatar"/><Block className="is-line"/><Block className="is-line is-short"/><Block className="is-line is-end"/></div>)}</div>; }

export function WorkspaceSkeleton({ variant }: { variant: WorkspaceSkeletonVariant }) {
  return <section className={`workspace-skeleton is-${variant}`} role="status" aria-busy="true">
    <span className="sr-only">Loading {labels[variant]}…</span><div className="workspace-skeleton-content" aria-hidden="true">
      {variant === 'profile' && <div className="workspace-skeleton-profile-card"><Block className="is-profile-avatar"/><div className="workspace-skeleton-profile-body"><Block className="is-kicker"/><Block className="is-title"/><div className="workspace-skeleton-fields">{Array.from({ length: 8 }, (_, i) => <div key={i}><Block className="is-field-label"/><Block className="is-field-value"/></div>)}</div></div></div>}
      {variant === 'candidates' && <div className="workspace-skeleton-panel"><div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-line is-short"/></div><div className="workspace-skeleton-toolbar"><Block/><Block/><Block/></div><Rows count={6}/></div>}
      {variant === 'dashboard' && <div className="workspace-skeleton-hero"><div><Block className="is-kicker"/><Block className="is-title"/><Block className="is-line is-wide"/></div><Block className="is-action"/></div>}
      {variant === 'dashboard' && <><div className="workspace-skeleton-kpis">{Array.from({ length: 4 }, (_, i) => <div key={i}><Block className="is-kicker"/><Block className="is-metric"/><Block className="is-line is-short"/></div>)}</div><div className="workspace-skeleton-dashboard-panels">{[0,1].map((i) => <div className="workspace-skeleton-panel" key={i}><Block className="is-title"/><Rows count={3}/></div>)}</div></>}
      {variant === 'screening' && <div className="workspace-skeleton-screening">
        <header className="workspace-skeleton-screening-heading"><div><Block className="is-kicker"/><Block className="is-title"/><Block className="is-line is-wide"/></div><Block className="is-rubric"/></header>
        <section className="workspace-skeleton-panel">
          <div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-line is-short"/></div>
          <div className="workspace-skeleton-screening-job"><div className="workspace-skeleton-screening-fields"><Block className="is-field-label"/><Block className="is-field-value"/><Block className="is-field-label"/><Block className="is-field-value is-tall"/></div><div className="workspace-skeleton-screening-guidance"><Block className="is-kicker"/><Block className="is-line is-wide"/><Block className="is-line"/><Block className="is-line is-short"/></div></div>
        </section>
        <section className="workspace-skeleton-panel">
          <div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-line is-short"/></div>
          <div className="workspace-skeleton-screening-upload"><Block className="is-upload"/><div className="workspace-skeleton-screening-tips"><Block className="is-kicker"/><Block className="is-line is-wide"/><Block className="is-line"/><Block className="is-line is-short"/></div></div>
          <div className="workspace-skeleton-screening-file"><Block className="is-avatar"/><Block className="is-line is-wide"/><Block className="is-line is-short"/></div>
        </section>
        <div className="workspace-skeleton-screening-actions"><Block className="is-line is-wide"/><Block className="is-action"/></div>
        <section className="workspace-skeleton-panel"><div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-line is-short"/></div><div className="workspace-skeleton-kpis"><div><Block className="is-kicker"/><Block className="is-metric"/></div><div><Block className="is-kicker"/><Block className="is-metric"/></div></div><Rows count={3}/></section>
      </div>}
      {variant === 'evaluations' && <div className="workspace-skeleton-panel"><div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-kicker"/></div><div className="workspace-skeleton-toolbar"><Block/><Block/></div><Block className="is-field-value is-tall"/></div>}
      {variant === 'insights' && <><div className="workspace-skeleton-kpis">{Array.from({ length: 4 }, (_, i) => <div key={i}><Block className="is-kicker"/><Block className="is-metric"/></div>)}</div><div className="workspace-skeleton-panel"><div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-line is-short"/></div><Rows count={5}/></div></>}
      {variant === 'ranking' && <div className="workspace-skeleton-panel"><div className="workspace-skeleton-panel-head"><Block className="is-title"/><Block className="is-kicker"/></div><Rows count={5}/></div>}
      {variant === 'history' && <div className="workspace-skeleton-panel"><Block className="is-title"/><Rows count={2}/></div>}
      {variant === 'detail' && <><div className="workspace-skeleton-profile-card"><Block className="is-profile-avatar"/><div className="workspace-skeleton-profile-body"><Block className="is-title"/><Block className="is-line is-wide"/><Block className="is-line is-short"/></div></div><div className="workspace-skeleton-panel"><Block className="is-title"/><Rows count={4}/></div></>}
    </div>
  </section>;
}

