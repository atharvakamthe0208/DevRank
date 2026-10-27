import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: auth.useAuth }));

import { RecruiterProfileEditForm, RecruiterProfileFields, RecruiterProfilePage, recruiterInitials, valuesFromProfile } from './RecruiterProfilePage';

describe('recruiter profile page', () => {
  beforeEach(() => auth.useAuth.mockReturnValue({ session: null, refresh: vi.fn() }));

  it('shows an accessible loading state while the authenticated profile is fetched', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RecruiterProfilePage)));
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading recruiter profile');
  });

  it('uses initials from an actual name and a neutral fallback when absent', () => {
    expect(recruiterInitials('Priya Sharma')).toBe('PS');
    expect(recruiterInitials('  ')).toBe('R');
  });

  it('shows the authenticated email and marks optional fields as unavailable instead of inventing them', () => {
    const html = renderToStaticMarkup(createElement(RecruiterProfileFields, { identity: {
      user: { id: 'user-1', email: 'priya@company.example' },
      profile: { id: 'user-1', display_name: 'Priya Sharma', phone_number: null, company_name: null, job_title: null, company_website: null, location_city: null, location_country: null, role: 'recruiter', approval_status: 'approved' },
      emailConfirmed: true,
    } }));
    expect(html).toContain('priya@company.example');
    expect(html).toContain('Not provided');
    expect(html).toContain('Phone');
    expect(html).toContain('Company website');
    expect(html).toContain('Approved');
  });

  it('renders real saved phone, professional, website, and location details', () => {
    const html = renderToStaticMarkup(createElement(RecruiterProfileFields, { identity: {
      user: { id: 'user-1', email: 'priya@company.example' },
      profile: { id: 'user-1', display_name: 'Priya Sharma', phone_number: '+1 555 123 4567', company_name: 'Northwind', job_title: 'Talent Partner', company_website: 'https://northwind.example', location_city: 'Seattle', location_country: 'USA', role: 'recruiter', approval_status: 'approved' },
      emailConfirmed: true,
    } }));
    expect(html).toContain('+1 555 123 4567');
    expect(html).toContain('Northwind');
    expect(html).toContain('Talent Partner');
    expect(html).toContain('href="https://northwind.example"');
    expect(html).toContain('Seattle, USA');
  });

  it('populates all editable fields from the authenticated profile response', () => {
    expect(valuesFromProfile({
      user: { id: 'user-1', email: 'priya@company.example' },
      profile: { id: 'user-1', display_name: 'Priya Sharma', phone_number: '+1 555 123 4567', company_name: 'Northwind', job_title: 'Talent Partner', company_website: 'https://northwind.example', location_city: 'Seattle', location_country: 'USA', role: 'recruiter', approval_status: 'approved' },
      emailConfirmed: true,
    })).toEqual({ displayName: 'Priya Sharma', phoneNumber: '+1 555 123 4567', companyName: 'Northwind', jobTitle: 'Talent Partner', companyWebsite: 'https://northwind.example', locationCity: 'Seattle', locationCountry: 'USA' });
  });

  it('uses the shared blue profile primary button styling', () => {
    const css = readFileSync(new URL('./recruiter-profile-page.css', import.meta.url), 'utf8');
    expect(css).toContain('background:var(--workspace-blue)');
    expect(css).toContain('background:var(--workspace-blue-hover)');
  });
  it('renders every editable field while keeping email read-only and access controls absent', () => {
    const html = renderToStaticMarkup(createElement(RecruiterProfileEditForm, {
      form: { displayName: 'Priya Sharma', phoneNumber: '+1 555 123 4567', companyName: 'Northwind', jobTitle: 'Talent Partner', companyWebsite: 'https://northwind.example', locationCity: 'Seattle', locationCountry: 'USA' },
      email: 'priya@company.example', saving: false, onFieldChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
    }));
    for (const field of ['Full name', 'Phone number', 'Company name', 'Job title / designation', 'Company website', 'City', 'Country']) expect(html).toContain(field);
    expect(html).toContain('priya@company.example');
    expect(html).toContain('type="submit"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain('name="role"');
    expect(html).not.toContain('name="approval_status"');
  });
});
