import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCandidates } from './useCandidates';
import { candidateListView } from './candidate-list-state';
import { candidateDeletionMessage } from './candidate-delete-confirmation';
import './candidate-workflow.css';

function CandidateTable({ items, deletingId, onDelete }: { items: ReturnType<typeof useCandidates>['items']; deletingId: string | null; onDelete: (candidate: ReturnType<typeof useCandidates>['items'][number]) => void }) {
  return <><p className="candidate-table-scroll-hint" id="candidate-table-scroll-hint">Scroll horizontally to see profile links and row actions.</p><div className="candidate-management-table-wrap" role="region" aria-label="Candidate list" aria-describedby="candidate-table-scroll-hint" tabIndex={0}><table className="candidate-management-table"><thead><tr><th scope="col">Candidate</th><th scope="col">GitHub</th><th scope="col">LeetCode</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Candidate actions</span></th></tr></thead><tbody>{items.map((candidate) => <tr key={candidate.id}>
    <td><Link className="management-candidate" to={`/candidates/${candidate.id}`}><span className="avatar avatar-user">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{candidate.name}</strong><small>{candidate.email || 'Email not provided'}</small></span></Link></td>
    <td>{candidate.githubUsername ? <a href={`https://github.com/${encodeURIComponent(candidate.githubUsername)}`} target="_blank" rel="noreferrer">@{candidate.githubUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td>{candidate.leetcodeUsername ? <a href={`https://leetcode.com/u/${encodeURIComponent(candidate.leetcodeUsername)}/`} target="_blank" rel="noreferrer">@{candidate.leetcodeUsername}</a> : <span className="candidate-field-empty">—</span>}</td>
    <td><time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time></td>
    <td><div className="candidate-row-actions"><Link className="row-action" to={`/candidates/${candidate.id}`} aria-label={`View ${candidate.name}`}>↗</Link><button className="candidate-delete-button" type="button" aria-label={`Delete ${candidate.name}`} disabled={deletingId !== null} onClick={() => onDelete(candidate)}>{deletingId === candidate.id ? 'Deleting…' : 'Delete'}</button></div></td>
  </tr>)}</tbody></table></div></>;
}

export function CandidateListPage() {
  const location = useLocation();
  const notice = (location.state as { notice?: unknown } | null)?.notice;
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [candidateToDelete, setCandidateToDelete] = useState<ReturnType<typeof useCandidates>['items'][number] | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const pageSize = 20;
  const { items, total, loading, error, reload, deleteCandidate } = useCandidates(page, pageSize);
  const view = candidateListView(loading, error, items.length);
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
    <section className="candidate-management-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> RECRUITER WORKSPACE</span><h1>Candidates</h1><p className="page-subtitle">Manage the candidate profiles in your workspace.</p></div><Link className="primary-button link-button" to="/candidates/new"><span>＋</span> Add candidate</Link></section>
    {typeof notice === 'string' && <p className="form-feedback candidate-success-message" role="status">{notice}</p>}
    {deleteNotice && <p className="form-feedback candidate-success-message" role="status">{deleteNotice}</p>}
    {deleteError && <p className="candidate-delete-error" role="alert">{deleteError}</p>}
    <section className="candidate-management-panel" aria-labelledby="candidate-list-title"><div className="candidate-management-panel-head"><div><h2 id="candidate-list-title">All candidates</h2><p>{total} {total === 1 ? 'candidate' : 'candidates'} in your workspace</p></div></div>
      {view === 'loading' ? <div className="candidate-list-state" role="status">Loading your candidates…</div> : view === 'error' ? <div className="candidate-list-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div> : view === 'empty' ? <div className="candidate-list-state"><span className="placeholder-mark">♙</span><h3>No candidates yet</h3><p>Add a candidate to start building your recruiter workspace.</p><Link className="primary-button link-button" to="/candidates/new">Add your first candidate</Link></div> : <><CandidateTable items={items} deletingId={deletingId} onDelete={setCandidateToDelete}/><div className="candidate-management-foot"><span>Showing {Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="Previous page">‹</button><button className="current-page" aria-current="page">{page}</button><button disabled={total <= page * pageSize} onClick={() => setPage((current) => current + 1)} aria-label="Next page">›</button></div></div></>}
    </section>
    <p className="candidate-management-note"><span aria-hidden="true">ⓘ</span> Candidate information is private to your recruiter account and protected by workspace authorization.</p>
    <dialog className="candidate-delete-dialog" ref={deleteDialogRef} aria-labelledby="candidate-delete-title" aria-describedby="candidate-delete-description" onCancel={() => setCandidateToDelete(null)} onClose={() => setCandidateToDelete(null)}>
      {candidateToDelete && <><h2 id="candidate-delete-title">Delete {candidateToDelete.name}?</h2><p id="candidate-delete-description">{candidateDeletionMessage(candidateToDelete.name)}</p><div className="candidate-delete-dialog-actions"><button className="candidate-delete-cancel" type="button" autoFocus onClick={() => deleteDialogRef.current?.close()}>Cancel</button><button className="candidate-delete-button" type="button" disabled={deletingId !== null} onClick={() => void handleDelete(candidateToDelete)}>{deletingId === candidateToDelete.id ? 'Deleting…' : 'Delete permanently'}</button></div></>}
    </dialog>
  </div>;
}
