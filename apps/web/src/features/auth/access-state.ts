export type RecruiterProfile = {
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
};

export type RecruiterAccessState = 'profile-missing' | 'unconfirmed' | 'admin' | 'approved' | 'rejected' | 'pending';

export function classifyRecruiterAccess(
  profile: RecruiterProfile | null,
  emailConfirmed: boolean,
): RecruiterAccessState {
  if (!profile) return 'profile-missing';
  if (!emailConfirmed) return 'unconfirmed';
  if (profile.role === 'admin' && profile.approval_status === 'approved') return 'admin';
  if (profile.role === 'recruiter' && profile.approval_status === 'approved') return 'approved';
  if (profile.approval_status === 'rejected') return 'rejected';
  return 'pending';
}
