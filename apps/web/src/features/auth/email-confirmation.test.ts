import { describe, expect, it } from 'vitest';
import { emailConfirmationRedirectTo } from './email-confirmation';

describe('email confirmation redirect', () => {
  it('returns to the local app callback when signup runs on localhost', () => {
    expect(emailConfirmationRedirectTo('http://localhost:5173')).toBe('http://localhost:5173/auth/callback');
  });

  it('returns to the deployed app callback when signup runs on production', () => {
    expect(emailConfirmationRedirectTo('https://dev-rank-ruddy.vercel.app')).toBe('https://dev-rank-ruddy.vercel.app/auth/callback');
  });
});
