import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCandidates } from './useCandidates';
import { candidateListView } from './candidate-list-state';
import { candidateDeletionMessage } from './candidate-delete-confirmation';
import { CandidateCsvImportDialog } from './CandidateCsvImportDialog';
import { DelayedAuthLoadingScreen } from '../auth/DelayedAuthLoadingScreen';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { AnimatedMetric } from '../../components/metrics/KpiCards';
import { filterAndSortCandidates, type CandidatePlatformFilter, type CandidateSortOrder } from './candidate-list-filtering';
import './candidate-workflow.css';

function CandidateTable({ items, deletingId, onDelete }: { items: ReturnType<typeof useCandidates>['items']; deletingId: string | null; onDelete: (candidate: ReturnType<typeof useCandidates>['items'][number]) => void }) {
  return <><p className="candidate-table-scroll-hint" id="candidate-table-scroll-hint">Scroll horizontally to see profile links and row actions.</p><div className="candidate-management-table-wrap" role="region" aria-label="Candidate list" aria-describedby="candidate-table-scroll-hint" tabIndex={0}><table className="candidate-management-table"><thead><tr><th scope="col">Candidate</th><th scope="col"><span className="platform-heading"><PlatformLogo platform="github"/>GitHub</span></th><th scope="col"><span className="platform-heading"><PlatformLogo platform="leetcode"/>LeetCode</span></th><th scope="col">Added</th><th scope="col"><span className="sr-only">Candidate actions</span></th></tr></thead><tbody>{items.map((candidate) => <tr key={candidate.id}>
    <td><Link className="management-candidate" to={`/candidates/${candidate.id}`}><span className="avatar avatar-user">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{candidate.name}</strong><small>{candidate.email || 'Email not provided'}</small></span></Link></td>
    <td>{candidate.githubUsername ? <a className="platform-profile-link" href={`https://github.com/${encodeURIComponent(candidate.githubUsername)}`} target="_blank" rel="noreferrer"><PlatformLogo platform="github"/>@{candidate.githubUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td>{candidate.leetcodeUsername ? <a className="platform-profile-link" href={`https://leetcode.com/u/${encodeURIComponent(candidate.leetcodeUsername)}/`} target="_blank" rel="noreferrer"><PlatformLogo platform="leetcode"/>@{candidate.leetcodeUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td><time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time></td>
    <td><div className="candidate-row-actions"><Link className="row-action" to={`/candidates/${candidate.id}`} aria-label={`View ${candidate.name}`}>↗</Link><button className="candidate-delete-button" type="button" aria-label={`Delete ${candidate.name}`} disabled={deletingId !== null} onClick={() => onDelete(candidate)}>{deletingId === candidate.id ? 'Deleting…' : 'Delete'}</button></div></td>
  </tr>)}</tbody></table></div></>;
}

export function CandidateListPage() {
  const location = useLocation();
  const notice = (location.state as { notice?: unknown } | null)?.notice;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<CandidatePlatformFilter>('all');
  const [sortOrder, setSortOrder] = useState<CandidateSortOrder>('newest');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [candidateToDelete, setCandidateToDelete] = useState<ReturnType<typeof useCandidates>['items'][number] | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const pageSize = 20;
  const { items, total, loading, error, reload, deleteCandidate } = useCandidates(page, pageSize);
  const view = candidateListView(loading, error, items.length);
  const visibleItems = filterAndSortCandidates(items, query, platformFilter, sortOrder);
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (candidateToDelete && dialog && !dialog.open) dialog.showModal();
  }, [candidateToDelete]);

  async function handleDelete(candidate: typeof items[number]) {
    deleteDialogRef.current?.close();
    setCandidateToDelete(null);
    setDeletingId(candidate.id);
    setDeleteError('');
    setDeleteNotice('');
    try {
      await deleteCandidate(candidate.id);
      setDeleteNotice(`${candidate.name} and its saved data were deleted.`);
      if (items.length === 1 && page > 1) setPage((current) => current - 1);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete this candidate. Try again.');
    } finally {
      setDeletingId(null);
    }
  }
  return <div className="candidate-management-page">
    <DelayedAuthLoadingScreen loading={loading} message="Loading your candidates…"/>
    <section className="candidate-management-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> RECRUITER WORKSPACE</span><h1>Candidates</h1><p className="page-subtitle">Manage the candidate profiles in your workspace.</p></div><div className="candidate-management-primary-actions"><button type="button" className="secondary-button" onClick={() => setImportOpen(true)}>Import CSV</button><Link className="primary-button link-button" to="/candidates/new"><span>＋</span> Add candidate</Link></div></section>
    {typeof notice === 'string' && <p className="form-feedback candidate-success-message" role="status">{notice}</p>}
    {deleteNotice && <p className="form-feedback candidate-success-message" role="status">{deleteNotice}</p>}
    {deleteError && <p className="candidate-delete-error" role="alert">{deleteError}</p>}
    <section className="candidate-management-panel" aria-labelledby="candidate-list-title"><div className="candidate-management-panel-head"><div><h2 id="candidate-list-title">All candidates</h2><p>{view === 'loading' ? 'Loading candidate count…' : view === 'error' ? 'Candidate count unavailable' : <><AnimatedMetric value={total}/> {total === 1 ? 'candidate' : 'candidates'} in your workspace</>}</p></div></div>
      {view !== 'loading' && view !== 'error' && view !== 'empty' && <div className="candidate-list-toolbar" role="group" aria-label="Filter and sort candidates on this page"><label>Search this page<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, or profile handle"/></label><label>Profile links<select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as CandidatePlatformFilter)}><option value="all">All candidates</option><option value="github">GitHub linked</option><option value="leetcode">LeetCode linked</option><option value="unlinked">No linked profiles</option></select></label><label>Sort this page<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as CandidateSortOrder)}><option value="newest">Recently added</option><option value="oldest">Oldest added</option><option value="name">Name A–Z</option></select></label></div>}
      {view === 'loading' ? <div className="candidate-list-state" role="status">Loading your candidates…</div> : view === 'error' ? <div className="candidate-list-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div> : view === 'empty' ? <div className="candidate-list-state"><span className="placeholder-mark">♙</span><h3>No candidates yet</h3><p>Add a candidate to start building your recruiter workspace.</p><Link className="primary-button link-button" to="/candidates/new">Add your first candidate</Link></div> : visibleItems.length === 0 ? <div className="candidate-list-state"><h3>No matches on this page</h3><p>Try a different name, email, profile handle, or link filter.</p><button className="secondary-button" type="button" onClick={() => { setQuery(''); setPlatformFilter('all'); }}>Clear filters</button></div> : <><CandidateTable items={visibleItems} deletingId={deletingId} onDelete={setCandidateToDelete}/><div className="candidate-management-foot"><span>Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total} · {visibleItems.length} on this page</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous page">‹</button><button className="current-page" aria-current="page">{page}</button><button disabled={total <= page * pageSize} onClick={() => setPage((current) => current + 1)} aria-label="Next page">›</button></div></div></>}
    </section>
    <p className="candidate-management-note"><span aria-hidden="true">ⓘ</span> Candidate information is private to your recruiter account and protected by workspace authorization.</p>
    <dialog className="candidate-delete-dialog" ref={deleteDialogRef} aria-labelledby="candidate-delete-title" aria-describedby="candidate-delete-description" onCancel={() => setCandidateToDelete(null)} onClose={() => setCandidateToDelete(null)}>
      {candidateToDelete && <><h2 id="candidate-delete-title">Delete {candidateToDelete.name}?</h2><p id="candidate-delete-description">{candidateDeletionMessage(candidateToDelete.name)}</p><div className="candidate-delete-dialog-actions"><button className="candidate-delete-cancel" type="button" autoFocus onClick={() => deleteDialogRef.current?.close()}>Cancel</button><button className="candidate-delete-button" type="button" disabled={deletingId !== null} onClick={() => void handleDelete(candidateToDelete)}>{deletingId === candidateToDelete.id ? 'Deleting…' : 'Delete permanently'}</button></div></>}
    </dialog>
    {importOpen && <CandidateCsvImportDialog onClose={() => setImportOpen(false)} onImported={reload}/>}
  </div>;
}
