export function confirmCandidateDeletion(candidateName: string, confirm: (message: string) => boolean = window.confirm) {
  return confirm(`Permanently delete ${candidateName}? This removes the candidate profile, saved platform evidence, evaluations, and comparison membership. This cannot be undone.`);
}
