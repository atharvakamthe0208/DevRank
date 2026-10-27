import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { calculateUnifiedAssessment, rankUnifiedAssessments, scoringCategories, unifiedAssessmentRankingResponseSchema } from '@devrank/contracts';
import { UnifiedRankingTable } from './InsightsPage';

const githubLeetCodeWeights = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };
const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function buildReport() {
  const complete = calculateUnifiedAssessment({
    id: '11111111-1111-4111-8111-111111111111', candidateId, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
    platformEvaluation: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', candidateId, roleId: 'software_developer', result: {
      scoringVersion: '4.0.1', targetRole: 'software_developer', roleWeightsUsed: githubLeetCodeWeights,
      categoryScores: scoringCategories.map(({ id }) => ({ categoryId: id, score: id === 'problem_solving_dsa' ? 0 : 80, status: 'scored', evidenceRefs: [`evidence-${id}`] })),
      evidence: scoringCategories.map(({ id }) => ({ evidenceId: `evidence-${id}`, categoryId: id, source: id === 'problem_solving_dsa' ? 'leetcode' : 'github', availability: 'available', normalizedValue: id === 'problem_solving_dsa' ? 0 : 80 })),
      platformEvidence: [], strengths: [], skillGaps: [],
    } },
    resume: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 100 }, preliminaryScore: null },
  });
  const preliminary = calculateUnifiedAssessment({
    id: '22222222-2222-4222-8222-222222222222', candidateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
    platformEvaluation: null,
    resume: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'provisional', score: 62 }, preliminaryScore: 62 },
  });
  const ranked = rankUnifiedAssessments([
    { candidateName: 'Complete Candidate', githubUsername: 'complete-gh', leetcodeUsername: 'complete-lc', assessment: complete },
    { candidateName: 'Partial Candidate', githubUsername: null, leetcodeUsername: null, assessment: preliminary },
  ]);
  return unifiedAssessmentRankingResponseSchema.parse({ roleId: 'software_developer', ...ranked, total: ranked.items.length });
}

describe('unified final candidate ranking table', () => {
  it('shows source handles and saved validated scores, including a genuine zero, with preliminary scores excluded', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(UnifiedRankingTable, { ranking: buildReport(), roleLabel: 'Software Developer' })));

    for (const heading of ['Rank', 'Candidate', 'GitHub', 'GitHub Score', 'LeetCode', 'LeetCode Score', 'Resume Score', 'Final Score /100', 'Status', 'Report']) expect(html).toContain(heading);
    expect(html).toContain('@complete-gh');
    expect(html).toContain('80/100');
    expect(html).toContain('@complete-lc');
    expect(html).toContain('0/100');
    expect(html).toContain('100/100');
    expect(html).toContain('76/100');
    expect(html).toContain('62 preliminary · excluded');
    expect(html).toContain('Incomplete · missing resume, github, leetcode');
    expect(html).toContain('Not found');
    expect(html).toContain('Not found');
    expect(html).toContain('Withheld');
    expect(html).toContain('#1');
    expect(html).toContain('View report');
  });

  it('renders current linked resume scores from the Insights API for Akshay and Atharva', () => {
    const base = buildReport();
    const ranking = unifiedAssessmentRankingResponseSchema.parse({
      ...base,
      items: base.items.map((item, index) => ({
        ...item,
        candidateName: index === 0 ? 'Akshay Nazare' : 'Atharva Kamthe',
        resumeScore: index === 0 ? 100 : 88.89,
      })),
    });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(UnifiedRankingTable, { ranking, roleLabel: 'Software Developer' })));

    expect(html).toContain('Akshay Nazare');
    expect(html).toContain('Atharva Kamthe');
    expect(html).toContain('100/100');
    expect(html).toContain('88.89/100');
    expect(html).toContain('76/100');
  });

  it('shows Not found when the API has no current validated linked resume score', () => {
    const base = buildReport();
    const ranking = unifiedAssessmentRankingResponseSchema.parse({
      ...base,
      items: base.items.map((item) => ({ ...item, resumeScore: null })),
    });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(UnifiedRankingTable, { ranking, roleLabel: 'Software Developer' })));

    expect(html).toContain('Not found');
    expect(html).not.toContain('62 preliminary · excluded');
  });
});
