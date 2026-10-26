import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PublicLandingPage } from './PublicLandingPage';

describe('public DevRank landing page', () => {
  it('renders the public product narrative and existing account routes', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PublicLandingPage)));
    expect(html).toContain('Evaluate engineering talent with');
    expect(html).toContain('Organize candidates');
    expect(html).toContain('Evaluate consistently');
    expect(html).toContain('Make informed decisions');
    expect(html).toContain('What’s missing stays visible.');
    expect(html).toContain('role-based rankings');
    expect(html.match(/href="\/signup"/g)).toHaveLength(4);
    expect(html.match(/href="\/login"/g)).toHaveLength(3);
  });

  it('labels the product preview as illustrative and exposes accessible tabs', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PublicLandingPage)));
    expect(html).toContain('Illustrative preview · sample data');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="landing-preview-panel"');
    expect(html).toContain('Sample candidate');
    expect(html).toContain('Missing information stays visible for recruiter review.');
  });

  it('provides a labeled mobile navigation control that starts closed', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PublicLandingPage)));
    expect(html).toContain('aria-label="Public navigation"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="landing-nav-links"');
  });
});
