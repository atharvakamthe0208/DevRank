import { useCallback, useEffect, useState } from 'react';
import type { Candidate } from '@devrank/contracts';
import { useAuth } from '../auth/AuthProvider';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { parseCandidateListApiResponse } from './candidate-response-validation';

export type CandidatePage = { items: Candidate[]; page: number; pageSize: number; total: number };
const EMPTY_PAGE: CandidatePage = { items: [], page: 1, pageSize: 20, total: 0 };

export function useCandidates(page: number, pageSize = 20) {
  const { session, refresh } = useAuth();
  const [data, setData] = useState<CandidatePage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);
  const reload = useCallback(() => setRefreshIndex((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (!session?.access_token) { setData(EMPTY_PAGE); setLoading(false); setError('Your secure session is unavailable. Sign in again to view candidates.'); return; }
      setLoading(true); setError('');
      try {
        const result = await apiRequest<unknown>(`/candidates?page=${page}&pageSize=${pageSize}`, { signal: controller.signal }, session.access_token);
        if (controller.signal.aborted) return;
        const parsed = parseCandidateListApiResponse(result);
        if (!parsed) throw new Error('Candidate data returned by the server was incomplete or invalid. Refresh the page or contact support.');
        setData(parsed);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiRequestError && cause.status === 401) {
          await supabase?.auth.signOut({ scope: 'local' });
          setError('Your session expired. Sign in again to continue.');
        } else if (cause instanceof ApiRequestError && cause.status === 403) {
          setError('Recruiter access is no longer approved. Refresh your access status or contact an administrator.');
          await refresh();
        } else setError(cause instanceof Error ? cause.message : 'Could not load candidates. Check your connection and try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [session?.access_token, page, pageSize, refreshIndex, refresh]);

  return { ...data, loading, error, reload };
}
