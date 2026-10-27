import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WorkspaceSkeleton } from './WorkspaceSkeleton';

describe('workspace page skeletons', () => {
  it.each(['profile', 'candidates', 'dashboard', 'evaluations', 'insights', 'detail', 'history', 'ranking'] as const)('renders an accessible %s skeleton', (variant) => {
    const html = renderToStaticMarkup(createElement(WorkspaceSkeleton, { variant }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`is-${variant}`);
  });

  it('sweeps a distinct highlight across placeholders and has a static reduced-motion fallback', () => {
    const css = readFileSync(new URL('./workspace-skeleton.css', import.meta.url), 'utf8');
    expect(css).toContain('.workspace-skeleton-block::after');
    expect(css).toContain('animation:workspace-skeleton-sweep 1.25s ease-in-out infinite');
    expect(css).toContain('@keyframes workspace-skeleton-sweep');
    expect(css).toContain('@media(prefers-reduced-motion:reduce)');
    expect(css).toContain('.workspace-skeleton-block::after{display:none;animation:none}');
  });
});
