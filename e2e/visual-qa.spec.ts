import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const storageState = process.env.PLAYWRIGHT_STORAGE_STATE
  ? resolve(process.env.PLAYWRIGHT_STORAGE_STATE)
  : undefined;

const viewportSizes = [
  { width: 320, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

const workspacePages = [
  {
    name: 'dashboard',
    route: '/dashboard',
    heading: /Welcome|Recruiter overview/,
    primaryAction: { role: 'link' as const, name: /Add candidate/ },
  },
  {
    name: 'candidates',
    route: '/dashboard/candidates',
    heading: 'Candidates',
    primaryAction: { role: 'link' as const, name: /Add candidate/ },
  },
  {
    name: 'evaluations',
    route: '/evaluations',
    heading: 'Evaluation',
    primaryAction: { role: 'button' as const, name: /Run evaluation/i },
  },
  {
    name: 'insights',
    route: '/dashboard/reports',
    heading: 'Insights & rankings',
    primaryAction: { role: 'link' as const, name: /Run an evaluation/i },
  },
  {
    name: 'resume-screening',
    route: '/screening',
    heading: 'Resume Screening',
    primaryAction: { role: 'button' as const, name: /Start screening/i },
  },
] as const;

async function verifyWorkspacePage(
  page: Page,
  route: string,
  headingName: string | RegExp,
  action: { role: 'link' | 'button'; name: RegExp },
  width: number,
  height: number,
  screenshotName: string,
) {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.setViewportSize({ width, height });
  await page.goto(route, { waitUntil: 'domcontentloaded' });

  const heading = page.getByRole('heading', { level: 1, name: headingName });
  await expect(heading).toBeVisible();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

  await page.evaluate(async () => {
    await document.fonts.load('400 16px Inter');
    await document.fonts.ready;
  });

  const typography = await heading.evaluate((element) => {
    const headingStyle = getComputedStyle(element);
    const bodyStyle = getComputedStyle(document.body);
    const loadedInter = Array.from(document.fonts).some((font) =>
      font.family.replace(/["']/g, '') === 'Inter' && font.status === 'loaded',
    );
    return {
      headingSize: Number.parseFloat(headingStyle.fontSize),
      headingWeight: Number.parseInt(headingStyle.fontWeight, 10),
      bodyFamily: bodyStyle.fontFamily,
      loadedInter,
    };
  });
  expect(typography.bodyFamily).toMatch(/Inter/i);
  expect(typography.loadedInter, 'Inter font face should finish loading').toBe(true);
  expect(typography.headingSize).toBeGreaterThanOrEqual(27);
  expect(typography.headingWeight).toBeGreaterThanOrEqual(650);

  const primaryAction = page.getByRole(action.role, { name: action.name });
  await expect(primaryAction).toBeVisible();
  const actionMetrics = await primaryAction.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      fontSize: Number.parseFloat(style.fontSize),
      left: rect.left,
      right: rect.right,
    };
  });
  expect(actionMetrics.fontSize).toBeGreaterThanOrEqual(13);
  expect(actionMetrics.left).toBeGreaterThanOrEqual(-1);
  expect(actionMetrics.right).toBeLessThanOrEqual(width + 1);

  const documentWidths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(Math.max(documentWidths.document, documentWidths.body)).toBeLessThanOrEqual(documentWidths.viewport + 1);
  expect(runtimeErrors).toEqual([]);

  const visibleLabels = await page.locator('label:visible').evaluateAll((labels) =>
    labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize)),
  );
  expect(visibleLabels.every((size) => size >= 12)).toBe(true);

  if (width === 390 || width === 1440) {
    const screenshotDirectory = resolve('visual-screenshots', screenshotName);
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${width}x${height}.png`),
      fullPage: true,
    });
  }
}

test.describe('authenticated workspace visual QA', () => {
  test.use({ storageState: storageState ?? { cookies: [], origins: [] } });

  for (const workspacePage of workspacePages) {
    for (const viewport of viewportSizes) {
      test(`${workspacePage.name} at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.skip(!storageState, 'Protected route QA needs PLAYWRIGHT_STORAGE_STATE for an approved, email-confirmed local recruiter.');
        await verifyWorkspacePage(
          page,
          workspacePage.route,
          workspacePage.heading,
          workspacePage.primaryAction,
          viewport.width,
          viewport.height,
          workspacePage.name,
        );
      });
    }
  }

  const evaluationId = process.env.PLAYWRIGHT_EVALUATION_ID;
  if (evaluationId) {
    for (const viewport of [viewportSizes[2], viewportSizes[5]]) {
      test(`full AI analysis at ${viewport.width}x${viewport.height}`, async ({ page }) => {
        test.skip(!storageState, 'Protected route QA needs PLAYWRIGHT_STORAGE_STATE for an approved, email-confirmed local recruiter.');
        await verifyWorkspacePage(
          page,
          `/evaluations/${encodeURIComponent(evaluationId)}/analysis`,
          'AI Candidate Analysis',
          { role: 'button', name: /Generate AI analysis|Try again/i },
          viewport.width,
          viewport.height,
          'full-ai-analysis',
        );
      });
    }
  }
});

test.describe('public typography smoke test', () => {
  for (const viewport of [viewportSizes[2], viewportSizes[5]]) {
    test(`login typography at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.load('400 16px Inter');
        await document.fonts.ready;
      });
      const typography = await heading.evaluate((element) => ({
        headingSize: Number.parseFloat(getComputedStyle(element).fontSize),
        headingWeight: Number.parseInt(getComputedStyle(element).fontWeight, 10),
        bodyFamily: getComputedStyle(document.body).fontFamily,
        loadedInter: Array.from(document.fonts).some((font) => font.family.replace(/["']/g, '') === 'Inter' && font.status === 'loaded'),
      }));
      expect(typography.bodyFamily).toMatch(/Inter/i);
      expect(typography.loadedInter).toBe(true);
      expect(typography.headingSize).toBeGreaterThanOrEqual(27);
      expect(typography.headingWeight).toBeGreaterThanOrEqual(650);
      const emailLabel = page.locator('label.auth-field').filter({ has: page.getByLabel('Work email') });
      const signInButton = page.getByRole('button', { name: /Sign in/i });
      await expect(emailLabel).toBeVisible();
      await expect(signInButton).toBeVisible();
      const labelSize = await emailLabel.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      const buttonSize = await signInButton.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(labelSize).toBeGreaterThanOrEqual(12);
      expect(buttonSize).toBeGreaterThanOrEqual(13);
      const pageWidths = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      expect(pageWidths).toBeLessThanOrEqual(viewport.width + 1);
      if (viewport.width === 390 || viewport.width === 1440) {
        const screenshotDirectory = resolve('visual-screenshots', 'login');
        await mkdir(screenshotDirectory, { recursive: true });
        await page.screenshot({ path: resolve(screenshotDirectory, `${viewport.width}x${viewport.height}.png`), fullPage: true });
      }
    });
  }
});
