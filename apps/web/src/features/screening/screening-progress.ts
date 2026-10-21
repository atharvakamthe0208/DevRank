import type { ScreeningDetailsResponse } from '@devrank/contracts';

export function screeningProgressLabel(resumes: Array<Pick<ScreeningDetailsResponse['resumes'][number], 'status'>>): string {
  const evaluated = resumes.filter(({ status }) => status === 'completed' || status === 'failed').length;
  const pending = resumes.filter(({ status }) => status === 'queued' || status === 'uploaded').length;
  const processing = resumes.filter(({ status }) => status === 'processing').length;
  return `Evaluated ${evaluated} of ${resumes.length} candidates${pending ? ` · ${pending} pending` : ''}${processing ? ` · ${processing} processing` : ''}`;
}
