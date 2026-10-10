import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { validateCandidateForm, type CandidateFormDraft, type CandidateFormErrors } from './candidateForm';

const initialDraft: CandidateFormDraft = { name: '', role: '', email: '' };

export function AddCandidatePage() {
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<CandidateFormErrors>({});
  const [feedback, setFeedback] = useState('');

  function updateField(field: keyof CandidateFormDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFeedback('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateCandidateForm(draft);
    setErrors(nextErrors);
    setFeedback(Object.keys(nextErrors).length === 0
      ? 'The details are valid, but candidate creation is not connected yet. Nothing has been saved.'
      : 'Check the highlighted fields and try again.');
  }

  return (
    <div className="candidate-form-page">
      <div className="candidate-form-heading">
        <div>
          <Link className="back-link" to="/dashboard">← <span>Back to overview</span></Link>
          <div className="eyebrow"><span className="eyebrow-line" /> CANDIDATE WORKSPACE</div>
          <h1>Add a candidate</h1>
          <p className="page-subtitle">Add profile details for your recruiting workspace.</p>
        </div>
        <Link className="form-close" to="/dashboard" aria-label="Close add candidate form">×</Link>
      </div>

      <form className="candidate-form-card" onSubmit={handleSubmit} noValidate>
        <div className="form-card-heading">
          <div><h2>Candidate details</h2><p>Basic information and public developer profiles.</p></div>
          <span className="form-step">01 <i /> 01</span>
        </div>

        <div className="form-notice" role="note"><span>ⓘ</span><p>Candidate creation is not connected to the backend yet. You can validate these details, but nothing will be saved.</p></div>

        <div className="candidate-fields">
          <label className="candidate-field" htmlFor="candidate-name">
            <span>Full name <i>*</i></span>
            <input id="candidate-name" name="name" autoComplete="name" value={draft.name} onChange={(event) => updateField('name', event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'candidate-name-error' : undefined} placeholder="e.g. Maya Chen" />
            {errors.name && <small className="field-error" id="candidate-name-error">{errors.name}</small>}
          </label>
          <label className="candidate-field" htmlFor="candidate-role">
            <span>Role or position <i>*</i></span>
            <input id="candidate-role" name="role" value={draft.role} onChange={(event) => updateField('role', event.target.value)} aria-invalid={Boolean(errors.role)} aria-describedby={errors.role ? 'candidate-role-error' : undefined} placeholder="e.g. Senior Frontend Engineer" />
            {errors.role && <small className="field-error" id="candidate-role-error">{errors.role}</small>}
          </label>
          <label className="candidate-field" htmlFor="candidate-email">
            <span>Email <small>Optional</small></span>
            <input id="candidate-email" name="email" type="email" autoComplete="email" value={draft.email} onChange={(event) => updateField('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'candidate-email-error' : undefined} placeholder="name@example.com" />
            {errors.email && <small className="field-error" id="candidate-email-error">{errors.email}</small>}
          </label>
          <label className="candidate-field" htmlFor="candidate-location">
            <span>Location <small>Optional</small></span>
            <input id="candidate-location" name="location" autoComplete="address-level2" placeholder="City, country or remote" />
          </label>
        </div>

        <div className="form-divider" />
        <div className="form-subheading"><h3>Developer profiles</h3><p>Profile links are optional and are not fetched by this demo.</p></div>
        <div className="candidate-fields profile-fields">
          <label className="candidate-field" htmlFor="candidate-github"><span>GitHub profile</span><div className="profile-input"><span>github.com/</span><input id="candidate-github" name="github" placeholder="username" /></div></label>
          <label className="candidate-field" htmlFor="candidate-leetcode"><span>LeetCode profile</span><div className="profile-input"><span>leetcode.com/u/</span><input id="candidate-leetcode" name="leetcode" placeholder="username" /></div></label>
          <label className="candidate-field" htmlFor="candidate-hackerrank"><span>HackerRank profile</span><div className="profile-input"><span>hackerrank.com/</span><input id="candidate-hackerrank" name="hackerrank" placeholder="username" /></div></label>
          <label className="candidate-field" htmlFor="candidate-experience"><span>Experience <small>Optional</small></span><input id="candidate-experience" name="experience" placeholder="e.g. 5 years" /></label>
        </div>

        {feedback && <p className={`form-feedback ${Object.keys(errors).length ? 'form-feedback-error' : ''}`} role="status">{feedback}</p>}
        <div className="candidate-form-actions"><Link className="secondary-button cancel-button" to="/dashboard">Cancel</Link><button className="primary-button" type="submit">Validate details <span>→</span></button></div>
      </form>
      <p className="mock-note"><span>ⓘ</span> Sample UI only. No candidate is created or persisted by this form.</p>
    </div>
  );
}
