import { describe, expect, it } from 'vitest';
import { candidateListView } from './candidate-list-state';

describe('candidate list view states', () => {
  it('shows loading while a request is pending', () => expect(candidateListView(true, '', 0)).toBe('loading'));
  it('shows a useful error state after request failure', () => expect(candidateListView(false, 'API unavailable', 0)).toBe('error'));
  it('shows the empty state for a successful empty result', () => expect(candidateListView(false, '', 0)).toBe('empty'));
  it('shows candidate records when present', () => expect(candidateListView(false, '', 3)).toBe('items'));
});
