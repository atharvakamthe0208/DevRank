export type AuthContext = {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  profile: {
    id: string;
    display_name: string | null;
    role: 'recruiter' | 'admin';
    approval_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  } | null;
  /** Forwarded only to request-scoped Supabase clients; never serialize or log this value. */
  accessToken: string;
};
