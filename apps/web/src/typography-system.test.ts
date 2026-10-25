import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('shared DevRank typography system', () => {
  it('loads Inter and defines a responsive, reusable type scale', () => {
    const html = read('../index.html');
    const styles = read('./styles.css');

    expect(html).toContain('fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
    expect(html).toContain('fonts.gstatic.com');
    expect(styles).toContain('--font-family-base:"Inter","Segoe UI",system-ui,sans-serif');
    expect(styles).toContain('--type-page-heading:clamp(28px,2.5vw,38px)');
    expect(styles).toContain('--type-section-heading:clamp(24px,1.8vw,26px)');
    expect(styles).toContain('--type-body:16px');
    expect(styles).toContain('--type-control:14px');
    expect(styles).toContain('--type-metadata:12px');
  });

  it('uses the shared family across dashboard, recruiter, report, auth, and admin styles', () => {
    const stylePaths = [
      './workspace-refinement.css',
      './components/metrics/kpi-cards.css',
      './features/admin/admin-recruiters-page.css',
      './features/auth/auth-loading.css',
      './features/auth/signup.css',
      './features/candidates/candidate-platform-data.css',
      './features/candidates/candidate-workflow.css',
      './features/evaluation/ai-analysis-report.css',
      './features/evaluation/evaluation-page.css',
      './features/evaluations/evaluation.css',
      './features/evaluations/unified-candidate-report.css',
      './features/insights/insights-page.css',
      './features/profile/recruiter-profile-page.css',
      './features/screening/resume-screening-page.css',
    ];

    for (const path of stylePaths) {
      expect(read(path), path).not.toMatch(/Manrope|DM Sans/);
    }
  });
});
