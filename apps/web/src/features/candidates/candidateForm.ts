export type CandidateFormDraft = {
  name: string;
  role: string;
  email: string;
};

export type CandidateFormErrors = Partial<Record<keyof CandidateFormDraft, string>>;

export function validateCandidateForm(draft: CandidateFormDraft): CandidateFormErrors {
  const errors: CandidateFormErrors = {};

  if (!draft.name.trim()) errors.name = 'Enter the candidate’s name.';
  if (!draft.role.trim()) errors.role = 'Enter a role or position.';
  if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }

  return errors;
}
