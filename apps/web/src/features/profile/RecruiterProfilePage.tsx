import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { recruiterProfileDetailsSchema, recruiterProfileUpdateSchema, type RecruiterProfileUpdate } from '@devrank/contracts';
import { z } from 'zod';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { SessionDraftNotice } from '../../lib/forms/SessionDraftNotice';
import { useSessionDraft } from '../../lib/forms/useSessionDraft';
import './recruiter-profile-page.css';

const recruiterProfileSchema = z.object({
  user: z.object({ id: z.string(), email: z.string().email().nullable() }),
  profile: z.object({
    id: z.string(), display_name: z.string().nullable(), ...recruiterProfileDetailsSchema.shape,
    role: z.enum(['recruiter', 'admin']), approval_status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
  }).nullable(),
  emailConfirmed: z.boolean(),
});
type RecruiterIdentity = z.infer<typeof recruiterProfileSchema>;
export type ProfileFormValues = {
  displayName: string; phoneNumber: string; companyName: string; jobTitle: string;
  companyWebsite: string; locationCity: string; locationCountry: string;
};

const emptyForm: ProfileFormValues = {
  displayName: '', phoneNumber: '', companyName: '', jobTitle: '', companyWebsite: '', locationCity: '', locationCountry: '',
};
function isProfileDraft(value: unknown): value is ProfileFormValues {
  const fields: (keyof ProfileFormValues)[] = ['displayName', 'phoneNumber', 'companyName', 'jobTitle', 'companyWebsite', 'locationCity', 'locationCountry'];
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return fields.every((field) => typeof record[field] === 'string')
    && (record.displayName as string).length <= 120
    && (record.phoneNumber as string).length <= 32
    && (record.companyName as string).length <= 150
    && (record.jobTitle as string).length <= 150
    && (record.companyWebsite as string).length <= 2048
    && (record.locationCity as string).length <= 100
    && (record.locationCountry as string).length <= 100;
}

export function valuesFromProfile(identity: RecruiterIdentity): ProfileFormValues {
  const profile = identity.profile;
  return {
    displayName: profile?.display_name ?? '', phoneNumber: profile?.phone_number ?? '',
    companyName: profile?.company_name ?? '', jobTitle: profile?.job_title ?? '',
    companyWebsite: profile?.company_website ?? '', locationCity: profile?.location_city ?? '',
    locationCountry: profile?.location_country ?? '',
  };
}

export function recruiterInitials(name: string | null | undefined): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase()).join('') || 'R';
}

function display(value: string | null | undefined): string {
  return value?.trim() || 'Not provided';
}

export function RecruiterProfileFields({ identity }: { identity: RecruiterIdentity }) {
  const profile = identity.profile;
  if (!profile) return null;
  const location = [profile.location_city, profile.location_country].filter((part): part is string => Boolean(part?.trim())).join(', ');
  return <div className="recruiter-profile-groups">
    <section className="recruiter-profile-group" aria-labelledby="profile-account-details">
      <div className="recruiter-profile-group-heading"><h3 id="profile-account-details">Account details</h3><p>Identity and workspace access</p></div>
      <div className="recruiter-profile-fields">
        <div><span>Work email</span><strong>{identity.user.email || 'Not available'}</strong></div>
        <div><span>Account type</span><strong>{profile.role === 'admin' ? 'Administrator' : 'Recruiter'}</strong></div>
        <div><span>Access status</span><strong>{profile.approval_status === 'approved' ? 'Approved' : profile.approval_status[0].toUpperCase() + profile.approval_status.slice(1)}</strong></div>
        <div><span>Phone</span><strong>{display(profile.phone_number)}</strong></div>
      </div>
    </section>
    <section className="recruiter-profile-group" aria-labelledby="profile-professional-details">
      <div className="recruiter-profile-group-heading"><h3 id="profile-professional-details">Professional details</h3><p>Organization and location</p></div>
      <div className="recruiter-profile-fields">
        <div><span>Company</span><strong>{display(profile.company_name)}</strong></div>
        <div><span>Job title</span><strong>{display(profile.job_title)}</strong></div>
        <div><span>Company website</span><strong>{profile.company_website ? <a href={profile.company_website} target="_blank" rel="noreferrer">{profile.company_website}</a> : 'Not provided'}</strong></div>
        <div><span>Location</span><strong>{location || 'Not provided'}</strong></div>
      </div>
    </section>
  </div>;
}
export function RecruiterProfileEditForm({
  form, email, saving, onFieldChange, onSubmit, onCancel,
}: {
  form: ProfileFormValues; email: string | null; saving: boolean;
  onFieldChange: (field: keyof ProfileFormValues, value: string) => void;
  onSubmit: (event: FormEvent) => void; onCancel: () => void;
}) {
  return <form className="recruiter-profile-edit" onSubmit={onSubmit}>
    <fieldset disabled={saving}>
      <legend>Personal information</legend>
      <label htmlFor="recruiter-display-name">Full name<input id="recruiter-display-name" autoComplete="name" maxLength={120} value={form.displayName} onChange={(event) => onFieldChange('displayName', event.target.value)} required /></label>
      <label htmlFor="recruiter-phone">Phone number<input id="recruiter-phone" type="tel" autoComplete="tel" maxLength={32} value={form.phoneNumber} onChange={(event) => onFieldChange('phoneNumber', event.target.value)} placeholder="+1 555 123 4567" /></label>
    </fieldset>
    <fieldset disabled={saving}>
      <legend>Professional information</legend>
      <label htmlFor="recruiter-company">Company name<input id="recruiter-company" autoComplete="organization" maxLength={150} value={form.companyName} onChange={(event) => onFieldChange('companyName', event.target.value)} /></label>
      <label htmlFor="recruiter-job-title">Job title / designation<input id="recruiter-job-title" autoComplete="organization-title" maxLength={150} value={form.jobTitle} onChange={(event) => onFieldChange('jobTitle', event.target.value)} /></label>
      <label htmlFor="recruiter-website">Company website<input id="recruiter-website" type="url" inputMode="url" autoComplete="url" maxLength={2048} value={form.companyWebsite} onChange={(event) => onFieldChange('companyWebsite', event.target.value)} placeholder="https://company.example" /></label>
      <label htmlFor="recruiter-city">City<input id="recruiter-city" autoComplete="address-level2" maxLength={100} value={form.locationCity} onChange={(event) => onFieldChange('locationCity', event.target.value)} /></label>
      <label htmlFor="recruiter-country">Country<input id="recruiter-country" autoComplete="country-name" maxLength={100} value={form.locationCountry} onChange={(event) => onFieldChange('locationCountry', event.target.value)} /></label>
    </fieldset>
    <div className="recruiter-profile-readonly"><span>Work email</span><strong>{email || 'Not available'}</strong><small>Email changes are managed through the account security flow.</small></div>
    <div className="recruiter-profile-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button><button className="secondary-button recruiter-cancel" type="button" disabled={saving} onClick={onCancel}>Cancel</button></div>
  </form>;
}

function profileUpdatePayload(form: ProfileFormValues): Omit<RecruiterProfileUpdate, 'displayName'> & { displayName: string } {
  return {
    displayName: form.displayName,
    phoneNumber: form.phoneNumber.trim() || null,
    companyName: form.companyName.trim() || null,
    jobTitle: form.jobTitle.trim() || null,
    companyWebsite: form.companyWebsite.trim() || null,
    locationCity: form.locationCity.trim() || null,
    locationCountry: form.locationCountry.trim() || null,
  };
}

export function RecruiterProfilePage() {
  const { session, refresh } = useAuth();
  const [identity, setIdentity] = useState<RecruiterIdentity | null>(null);
  const { value: form, status: draftStatus, persisted, setValue: setForm, initialize: initializeForm, clear: clearDraft } = useSessionDraft(session?.user?.id, 'recruiter-profile', emptyForm, isProfileDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        if (!session?.access_token) throw new Error('Your authenticated session is unavailable. Sign in again to load your profile.');
        const result = recruiterProfileSchema.parse(await apiRequest<unknown>('/auth/me', undefined, session.access_token));
        if (active) { setIdentity(result); initializeForm(valuesFromProfile(result)); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Your recruiter profile could not be loaded.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [session?.access_token, attempt, initializeForm]);

  function updateField(field: keyof ProfileFormValues, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function cancelEdit() {
    if (identity) clearDraft(valuesFromProfile(identity));
    setEditing(false); setError('');
  }

  function discardDraft() {
    if (identity) clearDraft(valuesFromProfile(identity));
    setError('');
    setNotice('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!session?.access_token || saving) return;
    setError(''); setNotice('');
    const parsed = recruiterProfileUpdateSchema.safeParse(profileUpdatePayload(form));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message ?? 'Check the profile details and try again.');
      return;
    }
    setSaving(true);
    try {
      const result = recruiterProfileSchema.parse(await apiRequest<unknown>('/auth/me', {
        method: 'PATCH', body: JSON.stringify(parsed.data),
      }, session.access_token));
      const savedValues = valuesFromProfile(result);
      setIdentity(result); clearDraft(savedValues); setEditing(false);
      setNotice('Your recruiter profile was saved.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your recruiter profile could not be saved.');
    } finally { setSaving(false); }
  }

  const profile = identity?.profile;
  return <div className="recruiter-profile-page">
    <Link className="back-link" to="/dashboard"><span aria-hidden="true">←</span> Back to overview</Link>
    <header className="recruiter-profile-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> ACCOUNT</span><h1>Recruiter profile</h1><p className="page-subtitle">Your personal and professional details for the DevRank workspace.</p></div></header>
    {loading ? <WorkspaceSkeleton variant="profile"/>
      : error && !identity ? <section className="recruiter-profile-state" role="alert"><p>{error}</p><button className="secondary-button recruiter-retry" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></section>
      : !identity || !profile ? <section className="recruiter-profile-state" role="alert"><h2>Profile unavailable</h2><p>Your signed-in account does not have a recruiter profile.</p></section>
      : <>
        {draftStatus && <SessionDraftNotice status={draftStatus} persisted={persisted} onDiscard={discardDraft}/>}
        {error && <p className="form-feedback form-feedback-error" role="alert">{error}</p>}
        {notice && <p className="form-feedback" role="status">{notice}</p>}
        <section className="recruiter-profile-card" aria-labelledby="recruiter-profile-name">
          <div className="recruiter-profile-avatar" aria-label={`${profile.display_name || 'Recruiter'} profile initials`}>{recruiterInitials(profile.display_name)}</div>
          <div className="recruiter-profile-main">
            <div className="recruiter-profile-title"><div><span className="recruiter-profile-kicker">RECRUITER ACCOUNT</span><h2 id="recruiter-profile-name">{profile.display_name || 'Name not provided'}</h2><div className="recruiter-profile-badges"><span className="recruiter-profile-role">{profile.role === 'admin' ? 'Administrator' : 'Recruiter'}</span><span className={`recruiter-profile-access is-${profile.approval_status}`}><i aria-hidden="true"/>{profile.approval_status === 'approved' ? 'Approved access' : profile.approval_status[0].toUpperCase() + profile.approval_status.slice(1)}</span></div></div>
              {!editing && <button className="secondary-button recruiter-edit" type="button" onClick={() => { setError(''); setNotice(''); setEditing(true); }}>Edit profile</button>}
            </div>
            {editing ? <RecruiterProfileEditForm form={form} email={identity.user.email} saving={saving} onFieldChange={updateField} onSubmit={(event) => void save(event)} onCancel={cancelEdit}/> : <RecruiterProfileFields identity={identity}/>}
          </div>
        </section>
      </>}
  </div>;
}
