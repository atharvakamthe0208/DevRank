export type CandidateListView = 'loading' | 'error' | 'empty' | 'items';

export function candidateListView(loading: boolean, error: string, itemCount: number): CandidateListView {
  if (loading) return 'loading';
  if (error) return 'error';
  return itemCount === 0 ? 'empty' : 'items';
}
