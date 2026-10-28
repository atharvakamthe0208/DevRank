import { describe, expect, it } from 'vitest';
import { createUserSessionCache } from './screening-navigation-cache';
import { clearSessionScopedState } from '../../lib/session-scoped-state';

describe('screening navigation cache', () => {
  it('preserves in-memory view state for the owning account and session only', () => {
    const cache = createUserSessionCache<{ query: string }>();
    cache.set('recruiter-a', 'screening-1', { query: 'candidate name' });
    expect(cache.get('recruiter-a', 'screening-1')).toEqual({ query: 'candidate name' });
    expect(cache.get('recruiter-b', 'screening-1')).toBeUndefined();
    expect(cache.get('recruiter-a', 'screening-2')).toBeUndefined();
  });

  it('clears the previous view when a new screening is started', () => {
    const cache = createUserSessionCache<string>();
    cache.set('recruiter-a', 'screening-1', 'view');
    cache.delete('recruiter-a', 'screening-1');
    expect(cache.get('recruiter-a', 'screening-1')).toBeUndefined();
  });

  it('clears cached resume details when the recruiter session ends', () => {
    const cache = createUserSessionCache<{ resumeText: string }>();
    cache.set('recruiter-a', 'screening-1', { resumeText: 'private resume content' });
    clearSessionScopedState();
    expect(cache.get('recruiter-a', 'screening-1')).toBeUndefined();
  });
});
