import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthLoadingScreen } from './AuthLoadingScreen';

describe('AuthLoadingScreen', () => {
  it('renders an accessible branded status with the operation message', () => {
    const markup = renderToStaticMarkup(<AuthLoadingScreen message="Verifying recruiter access…"/>);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Verifying recruiter access…');
    expect(markup).toContain('DevRank');
  });
});
