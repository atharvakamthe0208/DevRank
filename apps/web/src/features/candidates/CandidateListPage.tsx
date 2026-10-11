import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCandidates } from './useCandidates';
import { candidateListView } from './candidate-list-state';

function CandidateTable({ items }: { items: ReturnType<typeof useCandidates>['items'] }) {
  return <div className="candidate-management-table-wrap"><table className="candidate-management-table"><thead><tr><th>Candidate</th><th>GitHub</th><th>LeetCode</th><th>HackerRank</th><th>Added</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{items.map((candidate) => <tr key={candidate.id}>
    <td><Link className="management-candidate" to={`/candidates/${candidate.id}`}><span className="avatar avatar-user">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{candidate.name}</strong><small>{candidate.email || 'Email not provided'}</small></span></Link></td>
    <td>{candidate.githubUsername ? <a href={`https://github.com/${encodeURIComponent(candidate.githubUsername)}`} target="_blank" rel="noreferrer">@{candidate.githubUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td>{candidate.leetcodeUsername ? <a href={`https://leetcode.com/u/${encodeURIComponent(candidate.leetcodeUsername)}/`} target="_blank" rel="noreferrer">@{candidate.leetcodeUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td>{candidate.hackerrankUsername ? <a href={`https://www.hackerrank.com/profile/${encodeURIComponent(candidate.hackerrankUsername)}`} target="_blank" rel="noreferrer">@{candidate.hackerrankUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td><time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time></td>
    <td><Link className="row-action" to={`/candidates/${candidate.id}`} aria-label={`View ${candidate.name}`}>↗</Link></td>
  </tr>)}</tbody></table></div>;
}

export function CandidateListPage() {
  const location = useLocation();
  const notice = (location.state as { notice?: unknown } | null)?.notice;
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { items, total, loading, error, reload } = useCandidates(page, pageSize);
  const view = candidateListView(loading, error, items.length);
  return <div className="candidate-management-page">
    <section className="candidate-management-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> RECRUITER WORKSPACE</span><h1>Candidates</h1><p className="page-subtitle">Manage the candidate profiles in your workspace.</p></div><Link className="primary-button link-button" to="/candidates/new"><span>＋</span> Add candidate</Link></section>
    {typeof notice === 'string' && <p className="form-feedback candidate-success-message" role="status">{notice}</p>}
    <section className="candidate-management-panel" aria-labelledby="candidate-list-title"><div className="candidate-management-panel-head"><div><h2 id="candidate-list-title">All candidates</h2><p>{total} {total === 1 ? 'candidate' : 'candidates'} in your workspace</p></div></div>
      {view === 'loading' ? <div className="candidate-list-state" role="status">Loading your candidates…</div> : view === 'error' ? <div className="candidate-list-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div> : view === 'empty' ? <div className="candidate-list-state"><span className="placeholder-mark">♙</span><h3>No candidates yet</h3><p>Add a candidate to start building your recruiter workspace.</p><Link className="primary-button link-button" to="/candidates/new">Add your first candidate</Link></div> : <><CandidateTable items={items}/><div className="candidate-management-foot"><span>Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous page">‹</button><button className="current-page" aria-current="page">{page}</button><button disabled={total <= page * pageSize} onClick={() => setPage((current) => current + 1)} aria-label="Next page">›</button></div></div></>}
    </section>
    <p className="candidate-management-note"><span aria-hidden="true">ⓘ</span> Candidate information is private to your recruiter account and protected by workspace authorization.</p>
  </div>;
}
