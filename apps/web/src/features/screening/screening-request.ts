export type ScreeningUpload = { file: File; candidateId?: string | null };

export function buildScreeningRequest(jobTitle: string, jobDescription: string, resumes: ScreeningUpload[]): FormData {
  const body = new FormData();
  body.set('jobTitle', jobTitle);
  body.set('jobDescription', jobDescription);
  resumes.forEach(({ file }) => body.append('resumes', file, file.name));
  if (resumes.some(({ candidateId }) => candidateId)) {
    body.set('candidateIds', JSON.stringify(resumes.map(({ candidateId }) => candidateId ?? null)));
  }
  return body;
}
