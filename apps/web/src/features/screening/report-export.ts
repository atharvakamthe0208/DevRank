import type { ScreeningReportResponse } from '@devrank/contracts';

export function sortScreeningReportResumes(report: ScreeningReportResponse) {
  const rankById = new Map(report.ranking.ranked.map((item) => [item.resumeId, item.rank]));
  return [...report.details.resumes].sort((left, right) => {
    const leftRank = rankById.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightRank = rankById.get(right.id) ?? Number.POSITIVE_INFINITY;
    return leftRank - rightRank
      || (left.candidate?.name ?? '').localeCompare(right.candidate?.name ?? '')
      || left.filename.localeCompare(right.filename)
      || left.id.localeCompare(right.id);
  });
}

export function screeningReportCsv(report: ScreeningReportResponse): string {
  const rankById = new Map(report.ranking.ranked.map((item) => [item.resumeId, item.rank]));
  const escape = (input: unknown) => {
    let value = String(input ?? '');
    // Resume-derived text is untrusted; avoid spreadsheet formula execution on open.
    if (/^[\s]*[=+@-]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  const rows = [
    ['Candidate name', 'Resume', 'Rank', 'Score / 100', 'Resume text excerpts', 'Error'],
    ...sortScreeningReportResumes(report).map((resume) => {
      const requirements = resume.evaluation?.requirements ?? [];
      const preliminary = resume.preliminaryEvaluation;
      const score = resume.evaluation?.score ?? preliminary?.score ?? '';
      const excerpts = requirements.flatMap((item) => item.evidence.map(({ excerpt }) => excerpt));
      if (!requirements.length && preliminary) excerpts.push(...preliminary.criteria.flatMap((item) => [
        ...item.matchedTerms,
        ...(item.evidenceExcerpt ? [item.evidenceExcerpt] : []),
      ]));
      return [resume.candidate?.name ?? 'Name not identified', resume.filename, rankById.get(resume.id) ?? '', score,
        excerpts.join('; '), resume.error ?? ''];
    }),
  ];
  return `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`;
}
