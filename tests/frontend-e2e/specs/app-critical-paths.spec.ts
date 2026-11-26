import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// App-dependent skeletons (issue #361). Skipped until WEB_BASE_URL is provided.
// Route paths are PLACEHOLDERS; adjust to the real router when the app lands.
test.skip(!process.env.WEB_BASE_URL, 'WEB_BASE_URL not set: no web app to test');

const ROUTES = ['/checkout', '/merchant', '/disputes', '/arbitrator', '/admin'];

for (const route of ROUTES) {
  test(`route ${route}: no console errors, no axe violations, stable snapshot`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') }); // frozen clock
    await page.goto(route);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`${route.replace(/\W/g, '_') || 'root'}.png`);
  });
}

// TODO(#361): checkout (standard/escrowed/error recovery), merchant payout,
// dispute evidence hash, arbitrator commit-reveal, admin pause confirm flows,
// driven through the mock RPC and a mock wallet.
