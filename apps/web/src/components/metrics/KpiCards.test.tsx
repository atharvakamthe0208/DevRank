import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCards';
import { WorkspaceIcon } from '../icons/WorkspaceIcon';

describe('workspace KPI presentation', () => {
  it('renders a real metric with an accessible final value', () => {
    const html = renderToStaticMarkup(createElement(KpiCard, {
      label: 'Recent average', value: 72.5, decimals: 1, suffix: ' / 100', detail: 'Across 2 scored recent evaluations', icon: '◉',
    }));
    expect(html).toContain('aria-label="72.5 / 100"');
    expect(html).toContain('72.5 / 100');
    expect(html).toContain('Across 2 scored recent evaluations');
  });

  it('shows unavailable metrics as a dash instead of inventing zero', () => {
    const html = renderToStaticMarkup(createElement(KpiCard, {
      label: 'Recent average', value: undefined, detail: 'No scored evaluations yet', icon: '◉',
    }));
    expect(html).toContain('>—</strong>');
    expect(html).not.toContain('aria-label="0"');
    expect(html).toContain('No scored evaluations yet');
  });

  it('renders real progress denominators and only the supplied score series', () => {
    const html = renderToStaticMarkup(createElement(KpiCard, {
      label: 'Recent average', value: 72, detail: 'Across 2 scored recent evaluations', icon: '◉',
      progress: { value: 72, max: 100, label: 'Recent scored evaluation average out of 100' }, trend: [64, 80],
    }));
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="72"');
    expect(html).toContain('aria-label="Recent scored evaluation values: 64, 80"');
  });

  it('supports a consistent decorative outline icon inside the existing KPI icon container', () => {
    const html = renderToStaticMarkup(createElement(KpiCard, {
      label: 'Total candidates', value: 4, detail: 'Recruiter home', icon: createElement(WorkspaceIcon, { name: 'candidates', size: 17 }),
    }));
    expect(html).toContain('class="workspace-kpi-icon" aria-hidden="true"><svg');
    expect(html).toContain('width="17"');
    expect(html).toContain('stroke="currentColor"');
  });
});
