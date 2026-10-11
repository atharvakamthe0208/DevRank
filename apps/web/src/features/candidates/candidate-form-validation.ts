import { candidateCreateSchema, type CandidateCreateInput } from '@devrank/contracts';

export type CandidateFormValues = {
  name: string;
  email: string;
  githubUsername: string;
  leetcodeUsername: string;
  hackerrankUsername: string;
};

export type CandidateFormResult =
  | { success: true; data: CandidateCreateInput; errors: Record<string, string> }
  | { success: false; errors: Record<string, string> };

export function validateCandidateForm(values: CandidateFormValues): CandidateFormResult {
  const input = {
    name: values.name,
    ...(values.email.trim() ? { email: values.email } : {}),
    ...(values.githubUsername.trim() ? { githubUsername: values.githubUsername } : {}),
    ...(values.leetcodeUsername.trim() ? { leetcodeUsername: values.leetcodeUsername } : {}),
    ...(values.hackerrankUsername.trim() ? { hackerrankUsername: values.hackerrankUsername } : {}),
  };
  const result = candidateCreateSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    errors[field] ??= issue.message;
  }
  return { success: false, errors };
}
