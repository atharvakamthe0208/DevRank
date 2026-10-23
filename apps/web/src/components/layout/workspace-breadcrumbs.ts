export type WorkspaceBreadcrumb = { label: string; to?: string };

export function workspaceBreadcrumbs(pathname: string, labels: { candidateName?: string; evaluationName?: string; candidateListPath?: string } = {}): WorkspaceBreadcrumb[] {
  const root: WorkspaceBreadcrumb = { label: 'Workspace', to: '/dashboard' };
  const current = (label: string): WorkspaceBreadcrumb => ({ label });
  if (pathname === '/dashboard') return [{ label: 'Workspace' }, current('Overview')];
  if (pathname === '/profile') return [root, current('My Profile')];
  if (pathname === '/dashboard/candidates') return [root, current('Candidates')];
  const candidateList = { label: 'Candidates', to: typeof labels.candidateListPath === 'string' && /^\/dashboard\/candidates(?:\?.*)?$/.test(labels.candidateListPath) ? labels.candidateListPath : '/dashboard/candidates' };
  if (pathname === '/candidates/new') return [root, candidateList, current('Add Candidate')];
  if (pathname === '/screening') return [root, current('Resume Screening')];
  if (pathname === '/evaluations') return [root, current('Evaluations')];
  if (pathname === '/dashboard/reports') return [root, current('Insights')];

  const candidate = pathname.match(/^\/candidates\/([^/]+)(?:\/(report|evaluate))?$/);
  if (candidate) {
    const id = candidate[1];
    const details = { label: labels.candidateName?.trim() || 'Candidate Details', to: `/candidates/${id}` };
    const ancestors: WorkspaceBreadcrumb[] = [root, candidateList];
    if (!candidate[2]) return [...ancestors, current(labels.candidateName?.trim() || 'Candidate Details')];
    return [...ancestors, details, current(candidate[2] === 'report' ? 'Candidate Report' : 'Evaluate Candidate')];
  }

  const evaluation = pathname.match(/^\/evaluations\/([^/]+)(?:\/(analysis))?$/);
  if (evaluation) {
    const parent: WorkspaceBreadcrumb = { label: 'Evaluations', to: '/evaluations' };
    const evaluationLabel = labels.evaluationName?.trim() || 'Evaluation Details';
    if (evaluation[2]) return [root, parent, { label: evaluationLabel, to: `/evaluations/${evaluation[1]}` }, current('AI Analysis')];
    return [root, parent, current(evaluationLabel)];
  }
  return [root, current('Workspace')];
}
