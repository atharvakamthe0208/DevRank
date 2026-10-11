import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { clearPasswordRecovery, isPasswordRecoveryForUser, rememberPasswordRecovery } from './password-recovery';

type Profile = { id: string; display_name: string | null; role: 'recruiter' | 'admin'; approval_status: 'pending' | 'approved' | 'rejected' | 'suspended' } | null;
type AuthState = 'loading' | 'signed-out' | 'approved' | 'admin' | 'pending' | 'rejected' | 'unconfirmed' | 'error';
type AuthContextValue = {
  state: AuthState; session: Session | null; profile: Profile; error: string;
  passwordRecovery: boolean; clearPasswordRecovery: () => void;
  refresh: () => Promise<void>; signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [error, setError] = useState('');
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const verificationId = useRef(0);

  const restore = useCallback(async (nextSession: Session | null) => {
    const currentVerification = ++verificationId.current;
    setSession(nextSession);
    setError('');
    setProfile(null);
    if (!nextSession) { setState('signed-out'); return; }
    setState('loading');
    try {
      const result = await apiRequest<{ user: { id: string }; profile: Profile; emailConfirmed: boolean }>('/auth/me', undefined, nextSession.access_token);
      if (currentVerification !== verificationId.current) return;
      setProfile(result.profile);
      if (!result.profile) { setError('Your account profile is missing. Contact the DevRank project administrator.'); setState('error'); }
      else if (!result.emailConfirmed) setState('unconfirmed');
      else if (result.profile.role === 'admin' && result.profile.approval_status === 'approved') setState('admin');
      else if (result.profile.role === 'recruiter' && result.profile.approval_status === 'approved') setState('approved');
      else if (result.profile.approval_status === 'rejected') setState('rejected');
      else setState('pending');
    } catch (cause) {
      if (currentVerification !== verificationId.current) return;
      if (cause instanceof ApiRequestError && cause.status === 401) {
        await supabase?.auth.signOut({ scope: 'local' });
        setSession(null);
        setState('signed-out');
        return;
      }
      const message = cause instanceof ApiRequestError
        ? cause.status === 503
          ? 'Authentication or profile verification is temporarily unavailable. Please try again shortly.'
          : cause.message
        : 'Could not reach the DevRank API. Confirm it is running on the configured API URL and that its CORS policy allows this local Vite origin.';
      setError(message);
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setError('Supabase is not configured. Add the browser Supabase URL and publishable key.'); setState('error'); return; }
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY' && nextSession) {
        rememberPasswordRecovery(nextSession.user.id);
        setPasswordRecovery(true);
      } else if (event === 'INITIAL_SESSION') {
        const hasRecovery = isPasswordRecoveryForUser(nextSession?.user.id);
        setPasswordRecovery(hasRecovery);
        if (!nextSession || !hasRecovery) clearPasswordRecovery();
      } else if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        clearPasswordRecovery();
        setPasswordRecovery(false);
      }
      // Defer SDK/API work until the Supabase auth callback releases its internal lock.
      queueMicrotask(() => { if (active) void restore(nextSession); });
    });
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) { setError('Could not restore your session. Please refresh and try again.'); setState('error'); }
      else {
        const hasRecovery = isPasswordRecoveryForUser(data.session?.user.id);
        setPasswordRecovery(hasRecovery);
        if (!data.session || !hasRecovery) clearPasswordRecovery();
        void restore(data.session);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [restore]);

  const refresh = useCallback(async () => {
    if (!supabase) { setState('error'); return; }
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) { setError('Could not restore your session. Please refresh and try again.'); setState('error'); return; }
    await restore(data.session);
  }, [restore]);
  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) throw signOutError;
    setSession(null); setProfile(null); setState('signed-out');
    clearPasswordRecovery(); setPasswordRecovery(false);
  }, []);
  const clearRecovery = useCallback(() => { clearPasswordRecovery(); setPasswordRecovery(false); }, []);
  const value = useMemo(() => ({ state, session, profile, error, passwordRecovery, clearPasswordRecovery: clearRecovery, refresh, signOut }), [state, session, profile, error, passwordRecovery, clearRecovery, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
