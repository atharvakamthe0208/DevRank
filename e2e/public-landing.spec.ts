import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const viewports = [
  { width: 320, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

test.describe('public landing page responsive behavior', () => {
  for (const viewport of viewports) {
    test(`fits ${viewport.width}px viewport`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: /Request access/ }).first()).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Candidates' })).toHaveAttribute('aria-selected', 'true');

      for (const section of await page.locator('[data-landing-reveal]').all()) {
        await section.scrollIntoViewIfNeeded();
        await expect(section).toHaveClass(/landing-reveal-visible/);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator('.landing-hero-copy')).toHaveCSS('opacity', '1');
      await expect(page.locator('.landing-hero-visual')).toHaveCSS('opacity', '1');

      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      expect(Math.max(dimensions.document, dimensions.body)).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(errors).toEqual([]);

      if (viewport.width === 390 || viewport.width === 1440) {
        const directory = resolve('visual-screenshots', 'public-landing');
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: resolve(directory, `${viewport.width}x${viewport.height}.png`), fullPage: true });
      }
    });
  }

  test('supports preview keyboard navigation and reduced-motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const candidateTab = page.getByRole('tab', { name: 'Candidates' });
    await candidateTab.focus();
    await candidateTab.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Evaluations' })).toHaveAttribute('aria-selected', 'true');

    const motion = await page.locator('.landing-hero-copy').evaluate((element) => getComputedStyle(element).animationDuration);
    expect(motion).toBe('1e-05s');
    const revealClasses = await page.locator('[data-landing-reveal]').evaluateAll((sections) => sections.map((section) => section.className));
    expect(revealClasses.every((className) => !className.includes('landing-reveal-ready'))).toBe(true);
    await expect(page.getByRole('heading', { name: 'What’s missing stays visible.' })).toBeVisible();
  });
});
