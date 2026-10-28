import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFinalEvaluationReport, candidateSchema, evaluationResponseSchema, persistedEvaluationReadSchema, persistedEvaluationSchema, scoringCategories, type EvaluationResponse, type PersistedEvaluation, type PersistedEvaluationRead } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { EvaluationResults } from './EvaluationResults';
import { LegacyEvaluationResults } from './LegacyEvaluationResults';

const candidate = candidateSchema.parse({ id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', name: 'Test Candidate', email: 'test@example.com', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' });
const weights = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };

function evaluation(complete: boolean): PersistedEvaluation & { result: EvaluationResponse } {
  const evidence = scoringCategories.map((category, index) => ({ evidenceId: `evidence-${index}`, evidenceType: 'technical_screen' as const, source: `Assessment ${index + 1}`, description: `Evidence for ${category.displayName}`, verificationStatus: 'verified' as const, categoryId: category.id, normalizedValue: 80 + index, availability: 'available' as const }));
  const categoryScores = scoringCategories.map((category, index) => ({ categoryId: category.id, displayName: category.displayName, ...(complete || index < 2 ? { score: 80 + index, status: 'scored' as const, evidenceRefs: [`evidence-${index}`] } : { status: 'insufficient_evidence' as const, evidenceRefs: [] }), explanation: complete || index < 2 ? `Score for ${category.displayName}.` : `No normalized evidence for ${category.displayName}.` }));
  const result = evaluationResponseSchema.parse({
    schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId: candidate.id, targetRole: 'software_developer',
    ...(complete ? { overallScore: 83.45 } : {}), categoryScores, roleWeightsUsed: weights,
    evidence: complete ? evidence : evidence.slice(0, 2), confidence: 0.8, strengths: [], skillGaps: [], recommendations: [],
    missingEvidence: complete ? [] : scoringCategories.slice(2).map(({ id }) => id),
    calculationExplanation: complete ? 'Weighted score calculated from all six categories.' : 'No overall score until all categories are available.',
    evaluationStatus: complete ? 'completed' : 'insufficient_evidence',
    aiExplanation: { summary: 'Legacy compatibility summary.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  });
  const persisted = persistedEvaluationSchema.parse({ id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: candidate.id, roleProfileId: 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084', targetRole: 'software_developer', status: result.evaluationStatus, createdAt: '2026-10-14T01:00:00.000Z', result });
  return { ...persisted, result: evaluationResponseSchema.parse(persisted.result) };
}

describe('evaluation result view', () => {
  it('keeps the report panel and three-column report grid separate from the evaluation setup grid', () => {
    const reportCss = readFileSync(new URL('./evaluation.css', import.meta.url), 'utf8');
    const setupCss = readFileSync(new URL('../evaluation/evaluation-page.css', import.meta.url), 'utf8');
    expect(setupCss).toContain('.evaluation-categories { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(reportCss).toContain('.evaluation-report-panel { display: block; width: 100%; min-width: 0;');
    expect(reportCss).toContain('.evaluation-report-grid { display: grid; width: 100%; min-width: 0; grid-template-columns: repeat(3, minmax(0, 1fr));');
  });

  it('renders all six active v4 categories, scores, progress indicators, and deterministic overall score', () => {
    const saved = evaluation(true);
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result: saved.result } }));
    for (const label of ['Project Portfolio', 'Technical Skills', 'Development Activity', 'Collaboration', 'Current-Year Contributions', 'DSA &amp; Problem-Solving']) expect(html).toContain(label);
    expect(html).toContain('83.45');
    expect(html).toContain('Active GitHub + LeetCode evaluation');
    expect(html).toContain('Evaluation report');
    expect(html).toContain('class="evaluation-report-panel"');
    expect(html).toContain('class="evaluation-report-grid"');
    expect(html).toContain('About scoring');
    expect(html).toContain('Weighted score calculated from all six categories.');
    expect(html).toContain('Optional missing LeetCode profiles use the rubric-defined DSA zero policy.');
    expect(html).not.toContain('Required evidence gaps remain unscored');
    expect(html).not.toContain('Final GitHub + LeetCode evaluation report');
    expect(html.match(/<progress/g)).toHaveLength(6);
    expect(html).toContain('View evidence <span aria-hidden="true">→</span>');
    expect(html).toContain('<details class="evaluation-evidence-disclosure"><summary>View evidence <span aria-hidden="true">→</span></summary>');
    expect(html).toContain('data-score-state="scored"');
    expect(html).not.toContain('AI evidence summary');
    expect(html).toContain('Project Portfolio');
    expect(html).toContain('data-category="project_portfolio"');
    expect(html.match(/class="evaluation-category-card"/g)).toHaveLength(6);
    expect(html).not.toContain('Communication Skills');
  });

  it('shows missing evidence without a zero score or false overall result', () => {
    const saved = evaluation(false);
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result: saved.result } }));
    expect(html).toContain('Insufficient Evidence');
    expect(html).toContain('Evidence gaps · 4 categories');
    expect(html).toContain('Not calculated');
    expect(html.match(/<progress/g)).toHaveLength(2);
    expect(html).toContain('Not scored');
    expect(html).toContain('No normalized evidence for DSA &amp; Problem-Solving.');
    expect(html).toContain('data-score-state="unscored"');
    const dsaCard = html.match(/<article class="evaluation-category-card"[^>]*data-category="problem_solving_dsa"[\s\S]*?<\/article>/)?.[0];
    expect(dsaCard).toContain('Not scored');
    expect(dsaCard).not.toContain('<progress');
    expect(html).not.toContain('OVERALL SCORE</span><strong class="evaluation-overall-score">0');
  });

  it('keeps internal score explanations out of the default saved category card', () => {
    const saved = evaluation(true);
    const result = evaluationResponseSchema.parse({
      ...saved.result,
      categoryScores: saved.result.categoryScores.map((item) => item.categoryId === 'project_portfolio'
        ? { ...item, explanation: 'Arithmetic mean of 1 available normalized evidence value(s), rounded to two decimal places. Scored · evidence available · 1 supporting item' }
        : item),
    });
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result } }));
    const portfolioCard = html.match(/<article class="evaluation-category-card"[^>]*data-category="project_portfolio"[\s\S]*?<\/article>/)?.[0];
    expect(portfolioCard).toContain('Project Portfolio');
    expect(portfolioCard).toContain('Evidence for Project Portfolio');
    expect(portfolioCard).toContain('View evidence <span aria-hidden="true">→</span>');
    expect(portfolioCard).not.toContain('Arithmetic mean');
    expect(portfolioCard).not.toContain('Scored · evidence available');
    expect(portfolioCard).not.toContain('supporting item');
  });

  it('shows configured but unavailable LeetCode as unscored with its saved-snapshot reason', () => {
    const saved = evaluation(false);
    const baseReport = buildFinalEvaluationReport([], { leetcodeUsernameConfigured: true, leetcodeSnapshotPresent: false });
    const finalReport = {
      ...baseReport,
      categories: baseReport.categories.map((category) => category.categoryId === 'problem_solving_dsa'
        ? { ...category, metrics: { ...category.metrics, dataStatus: 'A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.' } }
        : category),
    };
    const result = evaluationResponseSchema.parse({
      ...saved.result,
      categoryScores: saved.result.categoryScores.map((item) => ({ categoryId: item.categoryId, displayName: item.displayName, status: 'insufficient_evidence' as const, evidenceRefs: [], explanation: item.explanation })),
      evidence: [],
      missingEvidence: scoringCategories.map(({ id }) => id),
      finalReport,
    });
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result } }));
    const dsaCard = html.match(/<article class="evaluation-category-card"[^>]*data-category="problem_solving_dsa"[\s\S]*?<\/article>/)?.[0];
    expect(dsaCard).toContain('Not scored');
    expect(dsaCard).toContain('Unavailable');
    expect(dsaCard).toContain('A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.');
    expect(dsaCard).not.toContain('<progress');
    expect(dsaCard).not.toContain('0 / 100');
  });

  it('shows a policy-defined missing LeetCode value as zero without fabricating supporting evidence', () => {
    const saved = evaluation(true);
    const categories = saved.result.categoryScores.map((item) => item.categoryId === 'problem_solving_dsa'
      ? { ...item, score: 0, scoreBasis: 'optional_missing_zero' as const, evidenceRefs: [], explanation: 'No LeetCode username or saved profile was provided. The active optional-evidence policy assigns this DSA index a zero; no supporting activity or evidence is inferred.' }
      : item);
    const evidence = saved.result.evidence.filter(({ categoryId }) => categoryId !== 'problem_solving_dsa');
    const overallScore = Number(categories.reduce((sum, item) => sum + (item.score ?? 0) * weights[item.categoryId as keyof typeof weights] / 100, 0).toFixed(2));
    const result = evaluationResponseSchema.parse({ ...saved.result, categoryScores: categories, evidence, overallScore });
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, status: 'completed', result } }));
    const dsaCard = html.match(/<article class="evaluation-category-card"[^>]*data-category="problem_solving_dsa"[\s\S]*?<\/article>/)?.[0];
    expect(dsaCard).toContain('aria-label="0" aria-live="off">0</span><small> / 100</small>');
    expect(dsaCard).toContain('No LeetCode profile was provided; the rubric applies its optional-profile policy.');
    expect(dsaCard).not.toContain('supporting item');
    expect(dsaCard).not.toContain('View evidence');
    expect(html).toContain(`aria-label="Overall score ${overallScore} out of 100"`);
  });

  it('hides saved source snapshots while keeping report categories and evidence controls', () => {
    const saved = evaluation(true);
    const result = evaluationResponseSchema.parse({ ...saved.result, platformEvidence: [{
      evidenceId: 'github-row:current-year', candidateId: candidate.id, source: 'github', evidenceType: 'current_year_contributions',
      availability: 'partial', observedAt: '2026-10-14T12:00:00.000Z', normalizedValue: { year: 2026, timezone: 'UTC', totalContributions: 44 },
      verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
      limitations: ['Contribution volume does not establish engineering competence.'],
      categoryMappings: [{ rubricId: 'github_leetcode_v4', categoryId: 'current_year_contributions', relation: 'supporting' }],
    }] });
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result } }));
    expect(html).toContain('Current-Year Contributions');
    expect(html).not.toContain('Saved source snapshots');
    expect(html).not.toContain('Provider snapshots are unverified inputs');
    expect(html.match(/class="evaluation-category-card"/g)).toHaveLength(6);
    expect(html).toContain('View evidence <span aria-hidden="true">→</span>');
    expect(html).toContain('Overall score');
    expect(html.match(/<progress/g)).toHaveLength(6);
    expect(html).toContain('83.45');
    expect(html).not.toContain('Scored · partial source evidence');
  });

  it('renders validated v1 history with all six original categories and no recalculated score', () => {
    const categories = ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability'] as const;
    const historical: PersistedEvaluationRead = {
      id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: candidate.id, roleProfileId: null,
      targetRole: 'software_developer', status: 'completed', createdAt: '2026-10-12T00:00:00.000Z',
      result: {
        schemaVersion: '1.0.0', candidateId: candidate.id, targetRole: 'software_developer',
        categoryScores: categories.map((categoryId) => ({ categoryId, displayName: categoryId === 'communication_skills' ? 'Communication Skills' : categoryId, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Historical evidence was insufficient.' })),
        roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
        evidence: [], strengths: [], skillGaps: [], recommendations: [], missingEvidence: [...categories],
        calculationExplanation: 'No overall score was stored.', evaluationStatus: 'insufficient_evidence',
        aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
        decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
      },
    };
    const html = renderToStaticMarkup(createElement(LegacyEvaluationResults, { candidate, evaluation: historical as Exclude<PersistedEvaluationRead, PersistedEvaluation> }));
    expect(html).toContain('Historical scoring format');
    expect(html).toContain('Communication Skills');
    expect(html).toContain('Not calculated');
    expect(html.match(/class="evaluation-category-card"/g)).toHaveLength(6);
    expect(html).not.toContain('<progress');

    const v3Historical = persistedEvaluationReadSchema.parse({ ...historical, result: { ...historical.result, schemaVersion: '3.0.0', scoringVersion: '3.0.0' } });
    const v3Html = renderToStaticMarkup(createElement(LegacyEvaluationResults, { candidate, evaluation: v3Historical as Exclude<PersistedEvaluationRead, PersistedEvaluation> }));
    expect(v3Html).toContain('HISTORICAL EVALUATION · V3');
    expect(v3Html).toContain('Communication Skills');
    expect(v3Html).not.toContain('Final GitHub + LeetCode evaluation report');

    const historicalWithEvidence = persistedEvaluationReadSchema.parse({
      ...historical,
      result: {
        ...historical.result,
        categoryScores: historical.result.categoryScores.map((category, index) => index === 0
          ? { ...category, score: 81.15, status: 'scored' as const, evidenceRefs: ['legacy-evidence'], explanation: 'Arithmetic mean of 1 available normalized evidence value(s), rounded to two decimal places.' }
          : category),
        evidence: [{ evidenceId: 'legacy-evidence', evidenceType: 'project', source: 'GitHub', description: 'Six public repositories are included in the saved snapshot.', normalizedValue: 6, verificationStatus: 'verified', categoryId: categories[0], availability: 'available' }],
        missingEvidence: [...categories.slice(1)],
      },
    });
    const historicalWithEvidenceHtml = renderToStaticMarkup(createElement(LegacyEvaluationResults, { candidate, evaluation: historicalWithEvidence as Exclude<PersistedEvaluationRead, PersistedEvaluation> }));
    const historicalPortfolio = historicalWithEvidenceHtml.match(/<article class="evaluation-category-card"[^>]*data-category="technical_skills"[\s\S]*?<\/article>/)?.[0];
    expect(historicalPortfolio).toContain('81.15');
    expect(historicalPortfolio).toContain('Six public repositories are included in the saved snapshot.');
    expect(historicalPortfolio).toContain('View evidence <span aria-hidden="true">→</span>');
    expect(historicalPortfolio).not.toContain('Arithmetic mean');

    const historicalUnavailable = {
      ...historical,
      result: {
        ...historical.result,
        categoryScores: historical.result.categoryScores.map((category) => category.categoryId === 'problem_solving_dsa'
          ? { ...category, explanation: 'A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.' }
          : category),
      },
    } as Exclude<PersistedEvaluationRead, PersistedEvaluation>;
    const historicalUnavailableHtml = renderToStaticMarkup(createElement(LegacyEvaluationResults, { candidate, evaluation: historicalUnavailable }));
    const historicalDsa = historicalUnavailableHtml.match(/<article class="evaluation-category-card"[^>]*data-category="problem_solving_dsa"[\s\S]*?<\/article>/)?.[0];
    expect(historicalDsa).toContain('Not scored');
    expect(historicalDsa).toContain('Unavailable');
    expect(historicalDsa).toContain('A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.');
    expect(historicalDsa).not.toContain('<progress');
  });
});
