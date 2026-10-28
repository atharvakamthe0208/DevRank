import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CandidateImportFinalActions } from './CandidateImportFinalActions';

const handlers = { onSkipPotentialMatchesChange: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() };

function renderActions(overrides: Partial<Parameters<typeof CandidateImportFinalActions>[0]> = {}) {
  return renderToStaticMarkup(createElement(CandidateImportFinalActions, {
    eligibility: { validRows: 2, validationErrors: 1, potentialMatches: null, eligibleRows: null },
    previewIsCurrent: false,
    skipPotentialMatches: true,
    ...handlers,
    busy: false,
    checkingDuplicates: false,
    importing: false,
    importingLabel: 'Importing…',
    importFailed: false,
    confirmBlocked: false,
    ...overrides,
  }));
}

describe('CSV import final action area', () => {
  it('does not expose import before a successful duplicate check', () => {
    const html = renderActions();
    expect(html).toContain('Check duplicates first');
    expect(html).toContain('Check duplicates after mapping columns');
    expect(html).toMatch(/Confirm and import<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm and import/);
    expect(html).not.toContain('Continue to confirmation');
  });

  it('shows fresh match counts, skip policy, and a ready confirmation action', () => {
    const html = renderActions({
      eligibility: { validRows: 2, validationErrors: 1, potentialMatches: 1, eligibleRows: 1 },
      previewIsCurrent: true,
    });
    expect(html).toContain('<dt>Valid rows</dt><dd>2</dd>');
    expect(html).toContain('<dt>Rows with validation errors</dt><dd>1</dd>');
    expect(html).toContain('<dt>Potential matches</dt><dd>1</dd>');
    expect(html).toContain('<dt>Expected rows to create</dt><dd>1</dd>');
    expect(html).toContain('Skip potential matches (recommended)');
    expect(html).toMatch(/<button[^>]*>Confirm and import<\/button>/);
  });

  it('keeps import disabled when zero rows are eligible or a request is running', () => {
    const noRows = renderActions({
      eligibility: { validRows: 2, validationErrors: 0, potentialMatches: 2, eligibleRows: 0 },
      previewIsCurrent: true,
    });
    expect(noRows).toContain('No rows are eligible');
    expect(noRows).toMatch(/<button[^>]*disabled=""[^>]*>Confirm and import/);

    const checking = renderActions({ busy: true, checkingDuplicates: true });
    expect(checking).toMatch(/<button[^>]*disabled=""[^>]*>Checking duplicates…/);
  });
});
