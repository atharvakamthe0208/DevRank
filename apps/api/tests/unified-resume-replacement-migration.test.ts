import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('atomic resume replacement migration', () => {
  it('requires the authenticated owner, a completed unlinked row, and a validated complete score', async () => {
    const migration = await readFile(resolve(process.cwd(), '../../supabase/migrations/20261026000000_replace_candidate_resume_result.sql'), 'utf8');
    expect(migration).toMatch(/owner_id\s*=\s*auth\.uid\(\)/i);
    expect(migration).toMatch(/replacement_status\s*<>\s*'completed'/i);
    expect(migration).toMatch(/replacement_candidate_id\s+is\s+not\s+null/i);
    expect(migration).toMatch(/evaluation->>'status'\s*=\s*'complete'/i);
    expect(migration).toMatch(/evaluation->>'rubricVersion'\s*=\s*'resume-job-match-1\.0\.0'/i);
    expect(migration).toMatch(/evaluation->>'scoreType'\s*=\s*'resume_job_match'/i);
  });

  it('keeps the old score record and wraps link changes in a transaction', async () => {
    const migration = await readFile(resolve(process.cwd(), '../../supabase/migrations/20261026000000_replace_candidate_resume_result.sql'), 'utf8');
    expect(migration.trimStart().startsWith('begin;')).toBe(true);
    expect(migration.trimEnd().endsWith('commit;')).toBe(true);
    expect(migration).toMatch(/set\s+candidate_id\s*=\s*null[\s\S]*?where\s+id\s*=\s*previous_resume_id/i);
    expect(migration).toMatch(/set\s+candidate_id\s*=\s*p_candidate_id/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.resume_screenings/i);
    expect(migration).not.toMatch(/set\s+evaluation\s*=/i);
  });
});
