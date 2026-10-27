import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useCandidates } from './useCandidates';
import { candidateListView } from './candidate-list-state';
import { candidateDeletionMessage } from './candidate-delete-confirmation';
import { CandidateCsvImportDialog } from './CandidateCsvImportDialog';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { AnimatedMetric } from '../../components/metrics/KpiCards';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { filterAndSortCandidates } from './candidate-list-filtering';
import { readCandidateListUrlState, type CandidateListReturn } from './candidate-list-navigation';
import { openCsvFilePicker, takeSelectedCsvFile } from './candidate-csv-import';
import './candidate-workflow.css';

function CandidateTable({ items, deletingId, onDelete, listReturn }: { items: ReturnType<typeof useCandidates>['items']; deletingId: string | null; onDelete: (candidate: ReturnType<typeof useCandidates>['items'][number]) => void; listReturn: CandidateListReturn }) {
  const navigate = useNavigate();
  function openCandidate(event: MouseEvent<HTMLAnchorElement>, candidateId: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(`/candidates/${candidateId}`, { state: { candidateListReturn: { ...listReturn, scrollY: typeof window === 'undefined' ? listReturn.scrollY : window.scrollY } } });
  }
  return <><p className="candidate-table-scroll-hint" id="candidate-table-scroll-hint">Scroll horizontally to see profile links and row actions.</p><div className="candidate-management-table-wrap" role="region" aria-label="Candidate list" aria-describedby="candidate-table-scroll-hint" tabIndex={0}><table className="candidate-management-table"><thead><tr><th scope="col">Candidate</th><th scope="col"><span className="platform-heading"><PlatformLogo platform="github"/>GitHub</span></th><th scope="col"><span className="platform-heading"><PlatformLogo platform="leetcode"/>LeetCode</span></th><th scope="col">Added</th><th scope="col"><span className="sr-only">Candidate actions</span></th></tr></thead><tbody>{items.map((candidate) => <tr key={candidate.id}>
    <td><Link className="management-candidate" to={`/candidates/${candidate.id}`} state={{ candidateListReturn: listReturn }} onClick={(event) => openCandidate(event, candidate.id)}><span className="avatar avatar-user">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{candidate.name}</strong><small>{candidate.email || 'Email not provided'}</small></span></Link></td>
    <td>{candidate.githubUsername ? <a className="platform-profile-link" href={`https://github.com/${encodeURIComponent(candidate.githubUsername)}`} target="_blank" rel="noreferrer"><PlatformLogo platform="github"/>@{candidate.githubUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td>{candidate.leetcodeUsername ? <a className="platform-profile-link" href={`https://leetcode.com/u/${encodeURIComponent(candidate.leetcodeUsername)}/`} target="_blank" rel="noreferrer"><PlatformLogo platform="leetcode"/>@{candidate.leetcodeUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td><time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time></td>
    <td><div className="candidate-row-actions"><Link className="row-action" to={`/candidates/${candidate.id}`} state={{ candidateListReturn: listReturn }} onClick={(event) => openCandidate(event, candidate.id)} aria-label={`View ${candidate.name}`}>↗</Link><button className="candidate-delete-button" type="button" aria-label={`Delete ${candidate.name}`} disabled={deletingId !== null} onClick={() => onDelete(candidate)}>{deletingId === candidate.id ? 'Deleting…' : 'Delete'}</button></div></td>
  </tr>)}</tbody></table></div></>;
}

export function CandidateListPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const notice = (location.state as { notice?: unknown } | null)?.notice;
  const urlState = readCandidateListUrlState(searchParams);
  const { page, platformFilter, sortOrder } = urlState;
  const savedSearch = (location.state as { candidateListSearch?: unknown } | null)?.candidateListSearch;
  const query = typeof savedSearch === 'string' ? savedSearch : '';
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [candidateToDelete, setCandidateToDelete] = useState<ReturnType<typeof useCandidates>['items'][number] | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const pageSize = 20;
  const { items, total, loading, error, reload, deleteCandidate } = useCandidates(page, pageSize);
  const view = candidateListView(loading, error, items.length);
  const visibleItems = filterAndSortCandidates(items, query, platformFilter, sortOrder);
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (candidateToDelete && dialog && !dialog.open) dialog.showModal();
  }, [candidateToDelete]);

  function updateListParams(updates: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (!value || (key === 'page' && value === '1') || (key === 'platform' && value === 'all') || (key === 'sort' && value === 'newest')) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace, state: location.state });
  }
  function updateSearch(value: string) {
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { ...(location.state as object | null), candidateListSearch: value } });
  }
  function clearFilters() {
    const next = new URLSearchParams(searchParams);
    next.delete('platform');
    setSearchParams(next, { replace: true, state: { ...(location.state as object | null), candidateListSearch: '' } });
  }
  const locationState = location.state as { candidateListRestoreScroll?: unknown } | null;
  useLayoutEffect(() => {
    if (loading || typeof locationState?.candidateListRestoreScroll !== 'number' || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, locationState.candidateListRestoreScroll as number), behavior: 'auto' }));
  }, [loading, location.key, locationState?.candidateListRestoreScroll]);
  const listReturn: CandidateListReturn = { path: `${location.pathname}${location.search}`, search: query, scrollY: typeof window === 'undefined' ? 0 : window.scrollY };

  async function handleDelete(candidate: typeof items[number]) {
    deleteDialogRef.current?.close();
    setCandidateToDelete(null);
    setDeletingId(candidate.id);
    setDeleteError('');
    setDeleteNotice('');
    try {
      await deleteCandidate(candidate.id);
      setDeleteNotice(`${candidate.name} and its saved data were deleted.`);
      if (items.length === 1 && page > 1) updateListParams({ page: String(page - 1) });
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete this candidate. Try again.');
    } finally {
      setDeletingId(null);
    }
  }
  function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = takeSelectedCsvFile(event.currentTarget);
    if (!file) return;
    setImportFile(file);
  }
  function closeImport() {
    setImportOpen(false);
    setImportFile(null);
  }
  return <div className="candidate-management-page">
    <input ref={importFileInputRef} className="candidate-import-file-picker" type="file" accept=".csv,text/csv" aria-hidden="true" tabIndex={-1} onChange={handleImportFileChange}/>
    <section className="candidate-management-heading"><div><h1>Candidates</h1><p className="page-subtitle">Manage the candidate profiles in your workspace.</p></div></section>
    {typeof notice === 'string' && <p className="form-feedback candidate-success-message" role="status">{notice}</p>}
    {deleteNotice && <p className="form-feedback candidate-success-message" role="status">{deleteNotice}</p>}
    {deleteError && <p className="candidate-delete-error" role="alert">{deleteError}</p>}
    <section className="candidate-management-panel" aria-labelledby="candidate-list-title"><div className="candidate-management-panel-head"><div><h2 id="candidate-list-title">All candidates</h2><p>{view === 'loading' ? 'Loading candidate count…' : view === 'error' ? 'Candidate count unavailable' : <><AnimatedMetric value={total}/> {total === 1 ? 'candidate' : 'candidates'} in your workspace</>}</p></div><div className="candidate-management-primary-actions"><button type="button" className="secondary-button" onClick={() => { setImportOpen(true); openCsvFilePicker(importFileInputRef.current); }}>Import CSV</button><Link className="primary-button link-button candidate-add-action" to="/candidates/new" state={{ candidateListReturn: listReturn }}><span>＋</span> Add candidate</Link></div></div>
      {view !== 'loading' && view !== 'error' && view !== 'empty' && <div className="candidate-list-toolbar" role="group" aria-label="Filter and sort candidates on this page"><label>Search this page<input type="search" value={query} onChange={(event) => updateSearch(event.target.value)} placeholder="Name, email, or profile handle"/></label><label>Profile links<select value={platformFilter} onChange={(event) => updateListParams({ platform: event.target.value })}><option value="all">All candidates</option><option value="github">GitHub linked</option><option value="leetcode">LeetCode linked</option><option value="unlinked">No linked profiles</option></select></label><label>Sort this page<select value={sortOrder} onChange={(event) => updateListParams({ sort: event.target.value })}><option value="newest">Recently added</option><option value="oldest">Oldest added</option><option value="name">Name A–Z</option></select></label></div>}
      {view === 'loading' ? <WorkspaceSkeleton variant="candidates"/> : view === 'error' ? <div className="candidate-list-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div> : view === 'empty' ? <div className="candidate-list-state"><span className="placeholder-mark">♙</span><h3>No candidates yet</h3><p>Add a candidate to start building your recruiter workspace.</p><Link className="primary-button link-button" to="/candidates/new" state={{ candidateListReturn: listReturn }}>Add your first candidate</Link></div> : visibleItems.length === 0 ? <div className="candidate-list-state"><h3>No matches on this page</h3><p>Try a different name, email, profile handle, or link filter.</p><button className="secondary-button" type="button" onClick={clearFilters}>Clear filters</button></div> : <><CandidateTable items={visibleItems} deletingId={deletingId} onDelete={setCandidateToDelete} listReturn={listReturn}/><div className="candidate-management-foot"><span>Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total} · {visibleItems.length} on this page</span><div className="pagination"><button disabled={page <= 1} onClick={() => updateListParams({ page: String(page - 1) })} aria-label="Previous page">‹</button><button className="current-page" aria-current="page">{page}</button><button disabled={total <= page * pageSize} onClick={() => updateListParams({ page: String(page + 1) })} aria-label="Next page">›</button></div></div></>}
    </section>
    <p className="candidate-management-note"><span aria-hidden="true">ⓘ</span> Candidate information is private to your recruiter account and protected by workspace authorization.</p>
    <dialog className="candidate-delete-dialog" ref={deleteDialogRef} aria-labelledby="candidate-delete-title" aria-describedby="candidate-delete-description" onCancel={() => setCandidateToDelete(null)} onClose={() => setCandidateToDelete(null)}>
      {candidateToDelete && <><h2 id="candidate-delete-title">Delete {candidateToDelete.name}?</h2><p id="candidate-delete-description">{candidateDeletionMessage(candidateToDelete.name)}</p><div className="candidate-delete-dialog-actions"><button className="candidate-delete-cancel" type="button" autoFocus onClick={() => deleteDialogRef.current?.close()}>Cancel</button><button className="candidate-delete-button" type="button" disabled={deletingId !== null} onClick={() => void handleDelete(candidateToDelete)}>{deletingId === candidateToDelete.id ? 'Deleting…' : 'Delete permanently'}</button></div></>}
    </dialog>
    {importOpen && <CandidateCsvImportDialog initialFile={importFile} onChooseFile={() => openCsvFilePicker(importFileInputRef.current)} onClose={closeImport} onImported={reload}/>}
  </div>;
}
