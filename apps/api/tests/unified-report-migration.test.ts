import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('candidate-linked resume report migration', () => {
  it('uses a nullable candidate association constrained by owner and permits only one linked screening per candidate', async () => {
    const migration = await readFile(resolve(process.cwd(), '../../supabase/migrations/20261024000000_link_screening_results_to_candidates.sql'), 'utf8');
    expect(migration).toMatch(/add column if not exists candidate_id uuid/i);
    expect(migration).toMatch(/foreign key \(candidate_id, owner_id\)\s+references public\.candidates\(id, owner_id\)/i);
    expect(migration).toMatch(/unique index if not exists resume_screenings_one_candidate_link_idx/i);
    expect(migration).toMatch(/where candidate_id is not null/i);
    expect(migration).toMatch(/never inferred from resume names or email addresses/i);
  });
});
