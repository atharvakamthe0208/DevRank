import { createElement, type ChangeEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { providerRankingResponseSchema, type EvaluationRole } from '@devrank/contracts';
import { describe, expect, it, vi } from 'vitest';
import { InsightsRankingSection, ProviderRankingTable } from './InsightsPage';

const providerRanking = providerRankingResponseSchema.parse({
  mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
  providerWeights: { github: 75, leetcode: 25 },
  items: [{ candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 3, totalCategories: 5, status: 'partial' }, leetcodeScore: 60, combinedScore: 75, status: 'ranked', missingProviders: [] }],
  page: 1, pageSize: 20, rankedTotal: 1, incompleteTotal: 0,
});

const roles: EvaluationRole[] = [{
  id: 'software_developer', displayName: 'Software Developer',
  weights: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
}];

describe('InsightsRankingSection', () => {
  it('shows GitHub + LeetCode rankings by default, keeps Role selection, and has no ranking mode selector', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InsightsRankingSection, {
      roles, roleId: roles[0]!.id, ranking: providerRanking, loading: false, error: '',
      onRoleChange: vi.fn(), onRetry: vi.fn(), onPageChange: vi.fn(),
    })));

    expect(markup).toContain('Candidate rankings');
    expect(markup).toContain('GitHub 75%, LeetCode 25%. Missing LeetCode data contributes zero.');
    expect(markup).toContain('id="ranking-role"');
    expect(markup).toContain('Software Developer');
    expect(markup).not.toContain('Ranking mode');
    expect(markup).not.toContain('id="ranking-mode"');
    expect(markup).toContain('Ranked Candidate');
    expect(markup).toContain('75.00');
  });

  it('passes Role selector changes to the existing role filter callback', () => {
    const onRoleChange = vi.fn();
    const section = InsightsRankingSection({
      roles: [...roles, { ...roles[0]!, id: 'ai_ml_engineer', displayName: 'AI / ML Engineer' }],
      roleId: roles[0]!.id, ranking: providerRanking, loading: false, error: '',
      onRoleChange, onRetry: vi.fn(), onPageChange: vi.fn(),
    });
    const sectionChildren = (section.props as { children: ReactNode }).children as ReactElement<{ children: ReactNode }>[];
    const headingChildren = sectionChildren[0]!.props.children as ReactElement<{ children: ReactNode }>[];
    const roleLabel = headingChildren[1]!;
    const roleChildren = roleLabel.props.children as ReactNode[];
    const roleControl = roleChildren[1] as ReactElement<{ onChange?: (event: ChangeEvent<HTMLSelectElement>) => void }>;
    const selectProps = roleControl.props as { onChange: (event: ChangeEvent<HTMLSelectElement>) => void };

    selectProps.onChange({ target: { value: 'ai_ml_engineer' } } as ChangeEvent<HTMLSelectElement>);
    expect(onRoleChange).toHaveBeenCalledWith('ai_ml_engineer');
  });
});

describe('ProviderRankingTable', () => {
  it('shows 75/25 provider scores, zero contribution for unavailable LeetCode, and unranked candidates', () => {
    const providerRanking = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
      providerWeights: { github: 75, leetcode: 25 },
      items: [
        { candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 3, totalCategories: 5, status: 'partial' }, leetcodeScore: 60, combinedScore: 75, status: 'ranked', missingProviders: [] },
        { candidateId: 'dd235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'LeetCode Unavailable', evaluationId: 'ac649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 2, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, combinedScore: 60, status: 'ranked', missingProviders: ['leetcode'] },
        { candidateId: 'ee235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'LeetCode Zero', evaluationId: 'bc649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 3, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, leetcodeScore: 0, combinedScore: 60, status: 'ranked', missingProviders: [] },
        { candidateId: 'cc235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Incomplete Candidate', evaluationId: '9c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', githubCoverage: { availableCategories: 0, totalCategories: 5, status: 'unavailable' }, leetcodeScore: 0, status: 'incomplete', missingProviders: ['github'] },
      ],
      page: 1, pageSize: 20, rankedTotal: 3, incompleteTotal: 1,
    });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProviderRankingTable, { ranking: providerRanking })));
    expect(markup).toContain('GitHub and LeetCode rankings. Resume scores are not included.');
    expect(markup).toContain('80');
    expect(markup).toContain('3/5 categories');
    expect(markup).toContain('75');
    expect(markup).toContain('0.00</strong> / 100<br/><small>Data unavailable — scored as 0</small>');
    expect(markup).toContain('Ranked · LeetCode unavailable');
    expect(markup).toContain('LeetCode Zero</a></td><td><strong>80.00</strong> / 100<br/><small>5/5 categories · complete</small></td><td><strong>0.00</strong> / 100</td><td><strong>60.00</strong> / 100</td><td>Ranked</td>');
    expect(markup).toContain('Incomplete Candidate</a></td><td>Unavailable</td><td><strong>0.00</strong> / 100</td><td>—</td><td>Unranked · missing github');
    expect(markup).toContain('GitHub 75%, LeetCode 25%. Missing LeetCode data contributes zero.');
    expect(markup).toContain('Resume scores are excluded');
  });

  it('provides accessible pagination when ranked and incomplete results span pages', () => {
    const paged = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
      providerWeights: { github: 75, leetcode: 25 },
      items: [{ candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, leetcodeScore: 100, combinedScore: 85, status: 'ranked', missingProviders: [] }],
      page: 1, pageSize: 1, rankedTotal: 1, incompleteTotal: 1,
    });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProviderRankingTable, { ranking: paged, onPageChange: () => undefined })));
    expect(markup).toContain('aria-label="Provider ranking pages"');
    expect(markup).toContain('Page 1 of 2');
    expect(markup).toContain('>Next</button>');
  });
});
