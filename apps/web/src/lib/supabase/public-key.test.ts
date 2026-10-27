import { describe, expect, it } from 'vitest';
import { selectSupabasePublicKey } from './public-key';

describe('selectSupabasePublicKey', () => {
  it('prefers the publishable key when both names are configured', () => {
    expect(selectSupabasePublicKey(' sb_publishable_project ', 'legacy-anon')).toBe('sb_publishable_project');
  });

  it('supports the legacy anon key when no publishable key is set', () => {
    expect(selectSupabasePublicKey(undefined, 'legacy-anon')).toBe('legacy-anon');
  });

  it('ignores blank key values', () => {
    expect(selectSupabasePublicKey('  ', ' ')).toBeUndefined();
  });
});
