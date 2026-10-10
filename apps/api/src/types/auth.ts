export type AuthContext = {
  userId: string;
  /** Forwarded only to request-scoped Supabase clients; never serialize or log this value. */
  accessToken: string;
};
