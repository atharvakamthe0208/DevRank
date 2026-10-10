import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { candidates, candidateStats, type Candidate } from '../candidates/mockCandidates';

function ScoreBadge({ score }: { score: number }) {
  return <span className={`score-badge ${score >= 85 ? 'score-high' : score >= 75 ? 'score-mid' : 'score-low'}`}><span />{score}</span>;
}

function CandidateRow({ person, index }: { person: Candidate; index: number }) {
  return <tr><td><span className="row-number">0{index + 1}</span></td><td><Link className="candidate-cell" to={`/candidates/${person.id}`}><span className={`avatar avatar-${person.color}`}>{person.initials}</span><span><strong>{person.name}</strong><small>{person.email}</small></span></Link></td><td><span className="role-cell">{person.role}</span></td><td><ScoreBadge score={person.score} /></td><td><span className="trend-cell">↗ {person.trend}</span></td><td><span className="updated-cell">{person.updated}</span></td><td><Link className="row-action" to={`/candidates/${person.id}`} aria-label={`View ${person.name}`}>↗</Link></td></tr>;
}

export function DashboardPage() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('top');
  const visibleCandidates = useMemo(() => {
    const filtered = candidates.filter((person) => `${person.name} ${person.role}`.toLowerCase().includes(query.toLowerCase()));
    return [...filtered].sort((a, b) => sort === 'recent' ? a.updated.localeCompare(b.updated) : b.score - a.score);
  }, [query, sort]);

  return <div className="dashboard-page">
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> MONDAY, OCTOBER 12, 2026</div><h1>Good morning, Aryan <span className="wave">✳</span></h1><p className="page-subtitle">Here’s what’s happening with your candidates today.</p></div><Link className="primary-button" to="/dashboard/candidates/new"><span>＋</span> Add candidate</Link></section>
    <section className="stat-grid" aria-label="Candidate statistics">
      <article className="stat-card"><div className="stat-top"><span>Total candidates</span><span className="stat-icon icon-lavender">♙</span></div><div className="stat-value">{String(candidateStats.total).padStart(2, '0')}<span className="stat-change">↗ 12.8%</span></div><div className="stat-foot">vs. last month <span className="mini-bars"><i/><i/><i/><i/><i/><i/><i/></span></div></article>
      <article className="stat-card"><div className="stat-top"><span>Average score</span><span className="stat-icon icon-mint">◉</span></div><div className="stat-value">{candidateStats.average}<small className="out-of">/ 100</small><span className="stat-change">↗ 4.2%</span></div><div className="stat-foot">across all candidates <span className="mini-bars green-bars"><i/><i/><i/><i/><i/><i/><i/></span></div></article>
      <article className="stat-card"><div className="stat-top"><span>Top performer</span><span className="stat-icon icon-yellow">✦</span></div><div className="top-performer"><span className="avatar avatar-lavender">{candidateStats.top.initials}</span><span><strong>{candidateStats.top.name}</strong><small>Score {candidateStats.top.score}</small></span></div><div className="stat-foot">Leading this month <span className="mini-bars yellow-bars"><i/><i/><i/><i/><i/><i/><i/></span></div></article>
      <article className="stat-card"><div className="stat-top"><span>Active this week</span><span className="stat-icon icon-peach">◷</span></div><div className="stat-value">{candidateStats.activeThisWeek}<span className="stat-change">↗ 8.3%</span></div><div className="stat-foot">candidates evaluated <span className="mini-bars peach-bars"><i/><i/><i/><i/><i/><i/><i/></span></div></article>
    </section>

    <section className="table-section"><div className="section-heading"><div><div className="section-title-row"><h2>Top candidates</h2><span className="count-pill">{candidates.length}</span></div><p>Ranked by overall candidate score</p></div><Link to="/dashboard/candidates" className="view-all">View all candidates <span>→</span></Link></div>
      <div className="table-toolbar"><label className="search-box"><span aria-hidden="true">⌕</span><input id="candidate-search" type="search" placeholder="Search candidates..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="toolbar-right"><button className="filter-button" type="button">☷ <span>Filter</span></button><label className="sort-select"><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="top">Top score</option><option value="recent">Recently updated</option></select><span className="select-chevron">⌄</span></label></div></div>
      <div className="table-scroll"><table className="candidate-table"><thead><tr><th>#</th><th>Candidate</th><th>Role</th><th>Score <span className="sort-caret">↕</span></th><th>Trend</th><th>Last activity</th><th aria-label="Actions" /></tr></thead><tbody>{visibleCandidates.map((person, index) => <CandidateRow key={person.id} person={person} index={index} />)}{visibleCandidates.length === 0 && <tr><td colSpan={7} className="empty-state">No candidates match “{query}”. Try another name or role.</td></tr>}</tbody></table></div>
      <div className="table-footer"><span>Showing <strong>{visibleCandidates.length}</strong> of {candidates.length} demo candidates</span><div className="pagination"><button disabled aria-label="Previous page">‹</button><button className="current-page">1</button><button disabled aria-label="Next page">›</button></div></div>
    </section>
    <p className="mock-note"><span>ⓘ</span> This is a demo workspace. Candidate data and scores shown are sample information.</p>
  </div>;
}
