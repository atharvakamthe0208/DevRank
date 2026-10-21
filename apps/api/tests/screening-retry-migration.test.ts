import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('durable screening retry migration', () => {
  it('uses bounded exponential delays and retains the compare-and-set attempt cap', async () => {
    const migration = await readFile(resolve(process.cwd(), '../../supabase/migrations/20261021000000_screening_retry_backoff.sql'), 'utf8');
    expect(migration).toMatch(/target\.retry_count\s*>=\s*3/);
    expect(migration).toMatch(/case\s+next_attempt\s+when\s+1\s+then\s+5\s+when\s+2\s+then\s+20\s+else\s+60\s+end/i);
    expect(migration).toMatch(/now\(\)\s*\+\s*make_interval\(secs\s*=>\s*delay_seconds\)/i);
    expect(migration).toMatch(/on conflict \(resume_id, attempt\) do nothing/i);
  });
});
