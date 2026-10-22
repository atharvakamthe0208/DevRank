import { describe, expect, it, vi } from 'vitest';
import { createCsvMapping, mapCsvRows, parseCsvText } from './candidate-csv-import';
import { getImportSyncCandidates, getImportSyncRetryCandidates, runImportPlatformSync, type ImportSyncCandidate } from './candidate-csv-import-sync';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';

function setup() {
  const rows = mapCsvRows(parseCsvText('Name,GitHub,LeetCode\nAri,ari-gh,ari-lc\nBea,,bea-lc\nCal,cal-gh,\nDup,dup-gh,dup-lc\n,unpersisted-gh,unpersisted-lc').rows, createCsvMapping(['Name', 'GitHub', 'LeetCode']));
  const result = {
    results: [
      { rowNumber: 2, status: 'created' as const, candidateId },
      { rowNumber: 3, status: 'created' as const, candidateId: '4ec6bf74-d5c2-48f8-b9d7-908e289090ef' },
      { rowNumber: 4, status: 'created' as const, candidateId: '81dcc56c-cfee-48bc-a5bc-1cd0e9ce10d0' },
      { rowNumber: 5, status: 'skipped' as const, reason: 'potential_duplicate' as const },
    ],
    createdCount: 3, skippedCount: 1, failedCount: 0,
  };
  return { rows, result };
}

describe('CSV import platform sync', () => {
  it('selects only newly created persisted candidates with a usable platform username', () => {
    const { rows, result } = setup();
    expect(getImportSyncCandidates(result, rows, 'github')).toMatchObject({
      candidates: [
        { rowNumber: 2, candidateId, name: 'Ari', profile: 'ari-gh' },
        { rowNumber: 4, candidateId: '81dcc56c-cfee-48bc-a5bc-1cd0e9ce10d0', name: 'Cal', profile: 'cal-gh' },
      ],
      skipped: [
        { rowNumber: 3, name: 'Bea', reason: 'No usable GitHub username was provided.' },
        { rowNumber: 5, name: 'Dup', reason: 'Candidate was not persisted by this import.' },
        { rowNumber: 6, name: 'CSV row 6', reason: 'Candidate was not persisted by this import.' },
      ],
    });
    expect(getImportSyncCandidates(result, rows, 'leetcode').candidates.map((item) => item.profile)).toEqual(['ari-lc', 'bea-lc']);
  });

  it('keeps provider sync attempts independent when one provider partially fails', async () => {
    const { rows, result } = setup();
    const githubEntries = getImportSyncCandidates(result, rows, 'github').candidates;
    const leetcodeEntries = getImportSyncCandidates(result, rows, 'leetcode').candidates;
    const github = await runImportPlatformSync(githubEntries, async (candidate) => {
      if (candidate.name === 'Ari') throw new Error('GitHub unavailable');
    });
    const leetcodeSync = vi.fn(async () => undefined);
    const leetcode = await runImportPlatformSync(leetcodeEntries, leetcodeSync);
    expect(github).toMatchObject([
      { rowNumber: 2, status: 'failed', message: 'GitHub unavailable' },
      { rowNumber: 4, status: 'synced' },
    ]);
    expect(leetcode).toHaveLength(2);
    expect(leetcode.every((item) => item.status === 'synced')).toBe(true);
  });

  it('retries failed candidates only and does not repeat successful syncs', () => {
    const entries: ImportSyncCandidate[] = [
      { rowNumber: 2, candidateId, name: 'Ari', profile: 'ari' },
      { rowNumber: 3, candidateId: '4ec6bf74-d5c2-48f8-b9d7-908e289090ef', name: 'Bea', profile: 'bea' },
    ];
    expect(getImportSyncRetryCandidates(entries, [])).toEqual(entries);
    expect(getImportSyncRetryCandidates(entries, [
      { rowNumber: 2, name: 'Ari', status: 'synced' },
      { rowNumber: 3, name: 'Bea', status: 'failed', message: 'Temporary provider error' },
    ])).toEqual([entries[1]]);
  });

  it('bounds concurrent provider requests and reports progress', async () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({ rowNumber: index + 2, candidateId, name: `Candidate ${index}`, profile: `user${index}` }));
    let active = 0;
    let maxActive = 0;
    const progress: Array<[number, number]> = [];
    const outcomes = await runImportPlatformSync(entries, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
    }, (completed, total) => progress.push([completed, total]), 2);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(outcomes).toHaveLength(5);
    expect(progress.at(-1)).toEqual([5, 5]);
  });
});
