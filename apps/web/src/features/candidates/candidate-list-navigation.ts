import type { CandidatePlatformFilter, CandidateSortOrder } from './candidate-list-filtering';

export type CandidateListUrlState = { page: number; platformFilter: CandidatePlatformFilter; sortOrder: CandidateSortOrder };
export type CandidateListReturn = { path: string; search: string; scrollY: number };

export function readCandidateListUrlState(params: URLSearchParams): CandidateListUrlState {
  const pageValue = Number(params.get('page'));
  const platform = params.get('platform');
  const sort = params.get('sort');
  return {
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    platformFilter: platform === 'github' || platform === 'leetcode' || platform === 'unlinked' ? platform : 'all',
    sortOrder: sort === 'oldest' || sort === 'name' ? sort : 'newest',
  };
}

export function safeCandidateListReturn(value: unknown): CandidateListReturn | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Partial<CandidateListReturn>;
  if (typeof result.path !== 'string' || !/^\/dashboard\/candidates(?:\?.*)?$/.test(result.path)) return null;
  return { path: result.path, search: typeof result.search === 'string' ? result.search : '', scrollY: typeof result.scrollY === 'number' && Number.isFinite(result.scrollY) ? Math.max(0, result.scrollY) : 0 };
}
