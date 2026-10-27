export type AuthContext = {
  userId: string;
  email: string | null;
  emailConfirmed: boolean;
  profile: {
    id: string;
    display_name: string | null;
    phone_number: string | null;
    company_name: string | null;
    job_title: string | null;
    company_website: string | null;
    location_city: string | null;
    location_country: string | null;
    role: 'recruiter' | 'admin';
    approval_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  } | null;
  /** Forwarded only to request-scoped Supabase clients; never serialize or log this value. */
  accessToken: string;
};
