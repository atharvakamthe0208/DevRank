import { describe, expect, it } from 'vitest';
import { workspaceBreadcrumbs } from './workspace-breadcrumbs';

describe('workspace breadcrumbs', () => {
  it.each([
    ['/dashboard', ['Workspace', 'Overview']], ['/dashboard/candidates', ['Workspace', 'Candidates']],
    ['/candidates/new', ['Workspace', 'Candidates', 'Add Candidate']], ['/screening', ['Workspace', 'Resume Screening']],
    ['/evaluations', ['Workspace', 'Evaluations']], ['/profile', ['Workspace', 'My Profile']], ['/dashboard/reports', ['Workspace', 'Insights']],
  ])('builds the logical hierarchy for %s', (path, labels) => {
    expect(workspaceBreadcrumbs(path).map(({ label }) => label)).toEqual(labels);
  });

  it('uses safe fallbacks on a directly opened candidate detail route and then displays the loaded name', () => {
    expect(workspaceBreadcrumbs('/candidates/abc').at(-1)?.label).toBe('Candidate Details');
    expect(workspaceBreadcrumbs('/candidates/abc', { candidateName: 'Ada Lovelace' }).at(-1)?.label).toBe('Ada Lovelace');
  });

  it('uses a data-aware evaluation label and keeps analysis under the evaluation ancestor', () => {
    expect(workspaceBreadcrumbs('/evaluations/eval-1/analysis', { evaluationName: 'Ada Lovelace · Frontend Engineer' }).map(({ label }) => label))
      .toEqual(['Workspace', 'Evaluations', 'Ada Lovelace · Frontend Engineer', 'AI Analysis']);
  });

  it('makes ancestors navigable and leaves the current item without a destination', () => {
    const crumbs = workspaceBreadcrumbs('/candidates/abc/report', { candidateName: 'Ada' });
    expect(crumbs.slice(0, 3).every(({ to }) => Boolean(to))).toBe(true);
    expect(crumbs.at(-1)?.to).toBeUndefined();
  });

  it('keeps candidate filters and pagination in the clickable candidate ancestor destination', () => {
    expect(workspaceBreadcrumbs('/candidates/abc', { candidateListPath: '/dashboard/candidates?page=3&platform=github' })[1].to)
      .toBe('/dashboard/candidates?page=3&platform=github');
    expect(workspaceBreadcrumbs('/candidates/abc', { candidateListPath: '//outside.test' })[1].to)
      .toBe('/dashboard/candidates');
  });

  it('does not add a redundant dashboard link to the workspace root breadcrumb', () => {
    expect(workspaceBreadcrumbs('/dashboard')[0].to).toBeUndefined();
  });
});
