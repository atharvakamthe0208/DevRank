export type RecruiterApplication = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  registered_at: string;
  approval_status: 'pending' | 'approved' | 'rejected';
};

export type RecruiterFilter = 'all' | RecruiterApplication['approval_status'];

export function summarizeRecruiterApplications(rows: RecruiterApplication[]) {
  return rows.reduce(
    (counts, row) => {
      counts[row.approval_status] += 1;
      return counts;
    },
    { pending: 0, approved: 0, rejected: 0 },
  );
}

export function filterRecruiterApplications(rows: RecruiterApplication[], filter: RecruiterFilter) {
  return filter === 'all' ? rows : rows.filter((row) => row.approval_status === filter);
}
