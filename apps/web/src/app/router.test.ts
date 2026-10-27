import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '../features/auth/AuthProvider';
import { appRoutes } from './router';

describe('landing and application entry routes', () => {
  it('renders the landing page directly at the root without waiting for auth restoration', () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(markup).toContain('Hire with a clearer view of');
    expect(markup).toContain('Explore DevRank');
    expect(markup).not.toContain('Restoring your secure session');
  });

  it('navigates from the landing entry link into the guarded workspace and shows auth loading', async () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] });
    const app = createElement(AuthProvider, null, createElement(RouterProvider, { router }));
    const landingMarkup = renderToStaticMarkup(app);
    expect(landingMarkup).toContain('href="/dashboard"');

    await router.navigate('/dashboard');
    expect(router.state.location.pathname).toBe('/dashboard');
    const dashboardMarkup = renderToStaticMarkup(app);
    expect(dashboardMarkup).toContain('Restoring your secure session');
  });
});
