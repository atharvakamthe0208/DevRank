import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { aiAnalysisResponseSchema, buildFinalEvaluationReport, evaluationResponseSchema, evaluationRunResponseSchema, parseProposedPlatformEvidence, persistedEvaluationSchema, scoringCategories, type AiAnalysisResponse, type EvaluationRunResponse } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { AiAnalysisSummary, EvaluationRunResult, EvaluationSetupCardHeading, EvaluationSetupHeader } from './EvaluationPage';
import { AiAnalysisReportView } from './AiAnalysisReportPage';
import { AiAnalysisRetryButton } from './AiAnalysisRetryButton';

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roleWeightsUsed = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };

function runResult(withLeetCodeEvidence = true): EvaluationRunResponse {
  const platformEvidence = withLeetCodeEvidence ? [{
    evidenceId: 'saved-leetcode-row',
    candidateId,
    source: 'leetcode' as const,
    evidenceType: 'solved_statistics' as const,
    availability: 'available' as const,
    observedAt: '2026-10-17T10:00:00.000Z',
    normalizedValue: { statistics: { problemsSolved: 208, easySolved: 100, mediumSolved: 92, hardSolved: 16 } },
    verificationStatus: 'unverified' as const,
    provenance: 'alfa_leetcode_api' as const,
    freshness: 'unassessed' as const,
    limitations: ['Provider statistics are informational and do not verify identity.'],
    categoryMappings: [{ rubricId: 'github_leetcode_v4' as const, categoryId: 'problem_solving_dsa' as const, relation: 'supporting' as const }],
  }] : [];
  return evaluationRunResponseSchema.parse({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'insufficient_evidence',
    candidate: { id: candidateId, name: 'Candidate Example' },
    role: { id: 'software_developer', displayName: 'Software Developer', weights: roleWeightsUsed },
    evaluatedAt: '2026-10-17T10:00:00.000Z',
    evaluation: {
      schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId, targetRole: 'software_developer',
      categoryScores: scoringCategories.map(({ id, displayName }) => ({ categoryId: id, displayName, ...(withLeetCodeEvidence && id === 'problem_solving_dsa' ? { score: 100, status: 'scored' as const, evidenceRefs: ['index:dsa'] } : { status: 'insufficient_evidence' as const, evidenceRefs: [] }), explanation: withLeetCodeEvidence && id === 'problem_solving_dsa' ? 'LeetCode v4 difficulty-weighted solved-volume index.' : 'No sufficient source evidence was supplied.' })),
      roleWeightsUsed, evidence: withLeetCodeEvidence ? [{ evidenceId: 'index:dsa', evidenceType: 'coding_assessment', source: 'alfa_leetcode_api', description: 'Saved LeetCode difficulty-weighted index.', normalizedValue: 100, verificationStatus: 'unverified', categoryId: 'problem_solving_dsa', availability: 'available' }] : [], platformEvidence, finalReport: buildFinalEvaluationReport(parseProposedPlatformEvidence(platformEvidence)), strengths: [], skillGaps: [], recommendations: [],
      missingEvidence: scoringCategories.filter(({ id }) => !withLeetCodeEvidence || id !== 'problem_solving_dsa').map(({ id }) => id),
      calculationExplanation: 'No overall active score is calculated until all categories have sufficient source evidence.',
      evaluationStatus: 'insufficient_evidence',
      aiExplanation: { summary: 'Evidence is insufficient.', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    },
    evidenceLimitations: ['Active evaluation evidence is incomplete.'],
  });
}

function completedAnalysis(): AiAnalysisResponse {
  const run = runResult();
  const evidence = scoringCategories.map(({ id, displayName }) => ({ evidenceId: `evidence-${id}`, evidenceType: 'technical_screen' as const, source: 'Saved assessment', description: `Saved source evidence for ${displayName}.`, verificationStatus: 'verified' as const, categoryId: id, normalizedValue: 70, availability: 'available' as const }));
  const result = evaluationResponseSchema.parse({
    ...run.evaluation,
    overallScore: 78,
    evaluationStatus: 'completed',
    missingEvidence: [],
    finalReport: undefined,
    evidence,
    categoryScores: run.evaluation.categoryScores.map((item) => ({ ...item, score: 70, status: 'scored', evidenceRefs: [`evidence-${item.categoryId}`] })),
  });
  const evaluation = persistedEvaluationSchema.parse({ id: run.id, candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'completed', createdAt: run.evaluatedAt, result });
  return aiAnalysisResponseSchema.parse({ status: 'completed', evaluation, analysis: {
    summary: 'The saved evidence shows experience across the listed source categories.', summaryEvidenceReferences: ['evidence-project_portfolio'],
    strengths: [1, 2, 3, 4].map((n) => ({ text: `Strength ${n} grounded in saved evidence.`, evidenceReferences: ['evidence-project_portfolio'] })),
    weaknesses: [1, 2, 3].map((n) => ({ text: n === 1 ? 'The history is incomplete.' : `Improvement area ${n} grounded in saved evidence.`, evidenceReferences: ['evidence-project_portfolio'] })),
    roleRelevance: 'The evidence relates to the selected role.', roleRelevanceEvidenceReferences: ['evidence-project_portfolio'],
    recommendations: [1, 2, 3, 4].map((n) => ({ text: n === 1 ? 'Review the cited source detail.' : `Recommendation ${n} grounded in saved evidence.`, evidenceReferences: ['evidence-project_portfolio'] })),
  } });
}

function renderEvaluationRunResult(props: Parameters<typeof EvaluationRunResult>[0]) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(EvaluationRunResult, props)));
}

describe('evaluation setup headings', () => {
  it('keeps one concise page title, candidate action, and secondary form heading', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement('div', null,
        createElement(EvaluationSetupHeader, { returnToCandidate: null, onBackToCandidate: () => undefined }),
        createElement(EvaluationSetupCardHeading),
      ),
    ));
    expect(html).toContain('<h1>Evaluation</h1>');
    expect(html).toContain('<h2>Evaluation</h2>');
    expect(html).toContain('View candidates');
    expect(html).toContain('Select a candidate and role.');
    expect(html).not.toContain('CANDIDATE ASSESSMENT');
    expect(html).not.toContain('Run final rubric evaluation');
  });
});

describe('evaluation run result', () => {
  it('shows the finalized v4 category result from the saved snapshot', () => {
    const html = renderEvaluationRunResult({
      result: runResult(), analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    });

    expect(html).toContain('aria-label="Evaluation report"');
    expect(html).not.toContain('Final GitHub + LeetCode evaluation report');
    for (const category of scoringCategories) expect(html).toContain(category.displayName.replaceAll('&', '&amp;'));
    expect(html).toContain('aria-label="100"');
    expect(html).toContain('<small> / 100</small>');
    expect(html).toContain('Overall score');
    expect(html).toContain('Score withheld');
    expect(html).toContain('An overall score is withheld because the available evidence is insufficient.');
    expect(html).not.toContain('Scores reflect available public evidence and should support—not replace—interviews and work samples.');
    expect(html).not.toContain('out of 100</small>');
    expect(html).toContain('View evidence');
    expect(html).toContain('Generate AI analysis');
    expect(html).toContain('View full analysis');
    expect(html).toContain('href="/evaluations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/analysis"');
    expect(html).toContain(`href="/candidates/${candidateId}"`);
    expect(html).toContain('evaluation-ai-primary-action');
    expect(html).not.toContain('Arithmetic mean of 1 available normalized evidence value(s), rounded to two decimal places');
    expect(html).not.toContain('Scoring notes and evidence limitations');
    expect(html).not.toContain('Technical source details');
    expect(html).not.toContain('Scored · evidence available · 1 supporting item');
    expect(html).toContain('evaluation-report-grid');
    expect(html.match(/class="evaluation-category-card"/g)).toHaveLength(6);
    expect(html).toContain('<progress class="evaluation-score-progress"');
    expect(html).toContain('Saved problem-solving evidence includes 100 easy, 92 medium, 16 hard problems.');
    expect(html).not.toContain('alfa_leetcode_api');
    expect(html).not.toContain('{&quot;statistics&quot;');
  });

  it('keeps final rubric categories unscored when the run has no saved platform evidence', () => {
    const html = renderEvaluationRunResult({
      result: runResult(false), analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    });

    expect(html).toContain('aria-label="Evaluation report"');
    expect(html).not.toContain('Final GitHub + LeetCode evaluation report');
    expect(html).toContain('Not scored');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Insufficient evidence');
  });

  it('shows a concise unavailable reason for configured LeetCode with no saved snapshot', () => {
    const base = runResult(false);
    const evaluation = {
      ...base.evaluation,
      categoryScores: base.evaluation.categoryScores.map((category) => category.categoryId === 'technical_skills'
        ? { ...category, explanation: 'Arithmetic mean of 1 available normalized evidence value(s), rounded to two decimal places.' }
        : category),
      finalReport: {
        ...base.evaluation.finalReport!,
        categories: base.evaluation.finalReport!.categories.map((category) => category.categoryId === 'problem_solving_dsa'
          ? { ...category, status: 'unavailable' as const, metrics: { ...category.metrics, dataStatus: 'A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.' } }
          : category),
      },
    };
    const result = evaluationRunResponseSchema.parse({ ...base, evaluation });
    const html = renderEvaluationRunResult({ result, analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined });
    const dsaCard = html.match(/<article class="evaluation-category-card"[^>]*data-category="problem_solving_dsa"[\s\S]*?<\/article>/)?.[0];
    expect(dsaCard).toContain('Not scored');
    expect(dsaCard).toContain('Unavailable');
    expect(dsaCard).toContain('A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.');
    expect(dsaCard).not.toContain('<progress');
    expect(html).not.toContain('Arithmetic mean of 1 available normalized evidence value(s), rounded to two decimal places');
    expect(html).not.toContain('Scored · evidence available · 1 supporting item');
  });

  it('shows real candidate profile details and available repository coverage in the compact header', () => {
    const base = runResult(false);
    const result = evaluationRunResponseSchema.parse({
      ...base,
      evaluation: {
        ...base.evaluation,
        platformEvidence: [{
          evidenceId: 'saved-github-row', candidateId, source: 'github', evidenceType: 'repository_snapshot',
          availability: 'available', observedAt: '2026-10-17T10:00:00.000Z',
          normalizedValue: {
            publicRepositoryCount: 14,
            languageSummary: { totalEligibleRepositories: 14, repositoriesAnalyzed: 14, observedLanguages: ['Python', 'TypeScript'], repositoriesMissingLanguage: 0, coverageStatus: 'complete' },
          },
          verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed', limitations: [],
          categoryMappings: [],
        }],
      },
    });
    const html = renderEvaluationRunResult({
      result,
      candidate: { id: candidateId, name: 'Candidate Example', email: 'person@example.com', githubUsername: 'candidate-gh', leetcodeUsername: 'candidate-lc', createdAt: '2026-10-17T10:00:00.000Z', updatedAt: '2026-10-17T10:00:00.000Z' },
      analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    });
    expect(html).toContain('Candidate Example');
    expect(html).toContain('person@example.com');
    expect(html).toContain('GitHub @candidate-gh');
    expect(html).toContain('LeetCode @candidate-lc');
    expect(html).toContain('Evidence-backed');
    expect(html).toContain('<strong>14</strong> public repositories');
    expect(html).toContain('<strong>2</strong> detected languages');
  });

  it('labels partial technical evidence and preserves the actual coverage explanation without assigning a score', () => {
    const base = runResult(false);
    const evaluation = {
      ...base.evaluation,
      finalReport: {
        ...base.evaluation.finalReport!,
        status: 'partial' as const,
        categories: base.evaluation.finalReport!.categories.map((category) => category.categoryId === 'technical_skills'
          ? { ...category, status: 'partial' as const, metrics: { repositoriesAnalyzed: 5, totalEligibleRepositories: 8, distinctRepositoryLanguages: 2, languagesObserved: 'Python, TypeScript', languageCoverageStatus: 'partial' } }
          : category),
      },
    };
    const result = evaluationRunResponseSchema.parse({ ...base, evaluation });
    const html = renderEvaluationRunResult({
      result, analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    });
    expect(html).toContain('Partial evidence');
    expect(html).toContain('5 of 8 eligible repositories analyzed');
    expect(html).toContain('Python, TypeScript');
    expect(html).toContain('Not scored');
  });

  it('shows a concise cited summary with a route to the detailed report', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisSummary, { response: completedAnalysis() })));
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Key Strengths');
    expect(html).toContain('Areas to Improve');
    expect(html).toContain('Recommended Next Steps');
    expect(html).toContain('Strength 3 grounded in saved evidence.');
    expect(html).not.toContain('Strength 4 grounded in saved evidence.');
    expect(html).toContain('Supporting references (1)');
    expect(html).not.toContain('Improvement area 3 grounded in saved evidence.');
    expect(html).not.toContain('Recommendation 4 grounded in saved evidence.');
  });

  it('shows a neutral insufficient-evidence summary and keeps the full report link', () => {
    const run = runResult(false);
    const evaluation = persistedEvaluationSchema.parse({ id: run.id, candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'insufficient_evidence', createdAt: run.evaluatedAt, result: run.evaluation });
    const response = aiAnalysisResponseSchema.parse({ status: 'insufficient_evidence', evaluation, analysis: null });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisSummary, { response })));
    expect(html).toContain('AI analysis is unavailable');
    expect(html).toContain('Open evaluation report');
    expect(html).not.toContain('0 / 100');
  });

  it('renders the detailed AI report with candidate context and without repeated category or source details', () => {
    const response = completedAnalysis();
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisReportView, { response, candidateName: 'Candidate Example', candidateEmail: 'candidate@example.com' })));
    expect(html).toContain('AI Candidate Analysis');
    expect(html).toContain('A detailed analysis of the candidate&#x27;s strengths, development areas, and recommendations.');
    expect(html).toContain('candidate@example.com');
    expect(html).toContain('aria-label="Candidate and evaluation summary"');
    expect(html).toContain('78 / 100');
    expect(html).toContain('Overall score');
    expect(html).toContain('Completed');
    expect(html).not.toContain('View six category results');
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Detailed insights');
    expect(html).toContain('Key Strengths');
    expect(html).toContain('Areas to Improve');
    expect(html).toContain('Recommended Next Steps');
    expect(html).toContain('Strength 1 grounded in saved evidence.');
    expect(html).toContain('Strength 3 grounded in saved evidence.');
    expect((html.match(/Strength 1 grounded in saved evidence\./g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('Top strength:');
    expect(html).not.toContain('Development focus:');
    expect(html).not.toContain('Strength 4 grounded in saved evidence.');
    expect(html).toContain('The history is incomplete.');
    expect(html).toContain('Recommendation 4 grounded in saved evidence.');
    expect(html).toContain('Role Relevance');
    expect(html).toContain('The evidence relates to the selected role.');
    expect(html).not.toContain('Key Takeaways');
    expect(html).toContain('View sources');
    expect(html).not.toContain('Supporting references (');
    expect(html).not.toContain('AI text below is explanatory only');
    expect(html).not.toContain('AI SUMMARY');
    expect(html).not.toContain('About this AI explanation');
    expect(html).not.toContain('<details class="ai-report-observation"');
    expect(html).toContain('Back to evaluation');
    expect(html).toContain('Regenerate analysis');
    expect(html).toContain('href="/evaluations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"');
  });

  it('keeps the saved deterministic result visible when the on-demand AI explanation fails', () => {
    const response = completedAnalysis();
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisReportView, {
      evaluation: response.evaluation, candidateName: 'Candidate Example', analysisError: 'AI analysis is temporarily unavailable.',
    })));
    expect(html).toContain('78 / 100');
    expect(html).toContain('AI analysis is temporarily unavailable.');
    expect(html).toContain('Overall score');
    expect(html).toContain('Try again');
  });

  it('keeps unavailable evidence and the saved score clear without offering an ineligible generation action', () => {
    const response = completedAnalysis();
    const insufficient = aiAnalysisResponseSchema.parse({ status: 'insufficient_evidence', evaluation: response.evaluation, analysis: null });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisReportView, { response: insufficient, candidateName: 'Candidate Example' })));
    expect(html).toContain('78 / 100');
    expect(html).toContain('AI explanation unavailable');
    expect(html).toContain('sufficient verified evidence');
    expect(html).not.toContain('Generate analysis');
  });

  it('keeps a single human-readable source disclosure and does not expose provider metadata', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisReportView, { response: completedAnalysis(), candidateName: 'Candidate Example' })));
    expect((html.match(/<details class="ai-report-sources-disclosure"/g) ?? []).length).toBe(1);
    expect(html).toContain('Saved Assessment');
    expect(html).not.toContain('evidence-project_portfolio');
    expect(html).not.toContain('alfa_leetcode_api');
  });
});

describe('AI analysis retry control', () => {
  it('disables retry until the provider Retry-After deadline and prevents duplicate clicks while loading', () => {
    const waiting = renderToStaticMarkup(createElement(AiAnalysisRetryButton, {
      className: 'text-button', retryAt: Date.now() + 10_000,
    }));
    expect(waiting).toContain('disabled');
    expect(waiting).toContain('Try again in');

    const loading = renderToStaticMarkup(createElement(AiAnalysisRetryButton, {
      className: 'text-button', pending: true,
    }));
    expect(loading).toContain('disabled');
    expect(loading).toContain('Analyzing');
  });
});
