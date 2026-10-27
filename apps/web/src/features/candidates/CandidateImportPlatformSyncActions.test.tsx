import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { candidateBulkImportResponseSchema } from '@devrank/contracts';
import { CandidateImportPlatformSyncActions } from './CandidateImportPlatformSyncActions';
import { createCsvMapping, mapCsvRows, parseCsvText } from './candidate-csv-import';
import type { ImportSyncPlatform } from './candidate-csv-import-sync';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const rows = mapCsvRows(parseCsvText('Name,GitHub,LeetCode\nAri,ari-gh,ari-lc\nBea,,bea-lc\nCal,cal-gh,\n,ghost-gh,ghost-lc').rows, createCsvMapping(['Name', 'GitHub', 'LeetCode']));
const result = candidateBulkImportResponseSchema.parse({
  results: [
    { rowNumber: 2, status: 'created', candidateId },
    { rowNumber: 3, status: 'created', candidateId: '4ec6bf74-d5c2-48f8-b9d7-908e289090ef' },
    { rowNumber: 4, status: 'skipped', reason: 'potential_duplicate' },
  ],
  createdCount: 2,
  skippedCount: 1,
  failedCount: 0,
});

describe('CSV import platform sync actions', () => {
  it('renders separate platform buttons and clearly lists candidates skipped for eligibility', () => {
    const html = renderToStaticMarkup(createElement(CandidateImportPlatformSyncActions, {
      result,
      rows,
      stateByPlatform: {
        github: { running: false, completed: 0, total: 0, outcomes: [] },
        leetcode: { running: false, completed: 0, total: 0, outcomes: [] },
      },
      onSync: vi.fn((_platform: ImportSyncPlatform) => undefined),
    }));

    expect(html).toContain('>Sync all GitHub</button>');
    expect(html).toContain('>Sync all LeetCode</button>');
    expect(html).toContain('Bea</span> — skipped: No usable GitHub username was provided.');
    expect(html).toContain('Cal</span> — skipped: Candidate was not persisted by this import.');
    expect(html).toContain('CSV row 5</span> — skipped: Candidate was not persisted by this import.');
    expect(html).toContain('without a usable username or a saved candidate profile are skipped');
  });

  it('renders retry and progress states without coupling the platform controls', () => {
    const html = renderToStaticMarkup(createElement(CandidateImportPlatformSyncActions, {
      result,
      rows,
      stateByPlatform: {
        github: { running: false, completed: 2, total: 2, outcomes: [{ rowNumber: 2, name: 'Ari', status: 'failed', message: 'Provider unavailable' }] },
        leetcode: { running: true, completed: 1, total: 2, outcomes: [{ rowNumber: 2, name: 'Ari', status: 'synced' }] },
      },
      onSync: vi.fn((_platform: ImportSyncPlatform) => undefined),
    }));

    expect(html).toContain('>Retry failed GitHub syncs</button>');
    expect(html).toContain('>Syncing 1/2…</button>');
    expect(html).toContain('failed: Provider unavailable');
    expect(html).toContain('LeetCode: 1 of 2 completed.');
  });
});
