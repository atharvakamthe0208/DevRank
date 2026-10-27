import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('unified assessment migration', () => {
  it('stores immutable role and owner scoped snapshots with idempotent source fingerprints', async () => {
    const migrationPath = fileURLToPath(new URL('../../../supabase/migrations/20261025000200_unified_assessments.sql', import.meta.url));
    const migration = await readFile(resolve(migrationPath), 'utf8');
    expect(migration).toMatch(/foreign key \(candidate_id, owner_id\)\s+references public\.candidates\(id, owner_id\)/i);
    expect(migration).toMatch(/foreign key \(platform_evaluation_id, owner_id\)\s+references public\.evaluations\(id, owner_id\)/i);
    expect(migration).toMatch(/foreign key \(resume_screening_id, owner_id\)\s+references public\.resume_screenings\(id, owner_id\)/i);
    expect(migration).toMatch(/unique \(owner_id, candidate_id, role_id, source_fingerprint\)/i);
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/owner_id = \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(/unique \(owner_id, candidate_id, role_id, source_fingerprint\)/i);
  });
});
