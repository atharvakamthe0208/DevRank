import { describe, expect, it } from 'vitest';
import { filterRecruiterApplications, searchRecruiterApplications, summarizeRecruiterApplications, type RecruiterApplication } from './recruiter-application-presentation';

const rows: RecruiterApplication[] = [
  { user_id: 'pending-1', email: 'pending@example.com', display_name: 'Pending Recruiter', registered_at: '2026-10-19T10:00:00Z', approval_status: 'pending' },
  { user_id: 'approved-1', email: null, display_name: 'Approved Recruiter', registered_at: '2026-10-18T10:00:00Z', approval_status: 'approved' },
  { user_id: 'rejected-1', email: 'rejected@example.com', display_name: null, registered_at: '2026-10-17T10:00:00Z', approval_status: 'rejected' },
];

describe('recruiter application presentation', () => {
  it('summarizes actual pending, approved, and rejected records', () => {
    expect(summarizeRecruiterApplications(rows)).toEqual({ pending: 1, approved: 1, rejected: 1 });
    expect(summarizeRecruiterApplications([])).toEqual({ pending: 0, approved: 0, rejected: 0 });
  });

  it('searches recruiter names and email addresses without changing the loaded data', () => {
    expect(searchRecruiterApplications(rows, 'PENDING')).toEqual([rows[0]]);
    expect(searchRecruiterApplications(rows, 'EXAMPLE.COM')).toEqual([rows[0], rows[2]]);
    expect(searchRecruiterApplications(rows, '   ')).toBe(rows);
    expect(searchRecruiterApplications(rows, 'missing')).toEqual([]);
  });

  it('filters status rows while preserving all records for the all filter', () => {
    expect(filterRecruiterApplications(rows, 'pending')).toEqual([rows[0]]);
    expect(filterRecruiterApplications(rows, 'approved')).toEqual([rows[1]]);
    expect(filterRecruiterApplications(rows, 'rejected')).toEqual([rows[2]]);
    expect(filterRecruiterApplications(rows, 'all')).toEqual(rows);
  });
});
