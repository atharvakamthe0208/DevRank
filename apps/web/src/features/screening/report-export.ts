import type { ScreeningReportResponse } from '@devrank/contracts';

export function screeningReportCsv(report: ScreeningReportResponse): string {
  const rankById = new Map(report.ranking.ranked.map((item) => [item.resumeId, item.rank]));
  const escape = (input: unknown) => {
    let value = String(input ?? '');
    // Resume-derived text is untrusted; avoid spreadsheet formula execution on open.
    if (/^[\s]*[=+@-]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  const rows = [
    ['Filename', 'Candidate name', 'Processing status', 'Rank', 'Score / 100', 'Score status', 'Matched requirements', 'Missing or unsupported requirements', 'Error'],
    ...report.details.resumes.map((resume) => {
      const requirements = resume.evaluation?.requirements ?? [];
      const preliminary = resume.preliminaryEvaluation;
      const score = resume.evaluation?.score ?? preliminary?.score ?? '';
      const scoreLabel = resume.evaluation?.score !== undefined ? `Validated ${resume.evaluation.status}` : preliminary ? 'Preliminary match' : '';
      const matched = requirements.length
        ? requirements.filter((item) => item.status === 'demonstrated').map((item) => item.description)
        : preliminary?.criteria.filter((item) => item.status === 'supported').map((item) => item.description) ?? [];
      const missing = requirements.length
        ? requirements.filter((item) => item.status !== 'demonstrated').map((item) => `${item.description} (${item.status.replaceAll('_', ' ')})`)
        : preliminary?.criteria.filter((item) => item.status === 'unverified').map((item) => `${item.description} (unverified in resume text)`) ?? [];
      return [resume.filename, resume.candidate?.name ?? '', resume.status, rankById.get(resume.id) ?? '', score, scoreLabel,
        matched.join('; '), missing.join('; '), resume.error ?? ''];
    }),
  ];
  return `\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`;
}
