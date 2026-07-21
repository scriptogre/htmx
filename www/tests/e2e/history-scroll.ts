import { test, expect } from './_fixtures';

const BASE_URL = process.env.HTMX_TEST_BASE_URL || '';

test.describe('History scroll restoration', () => {
    test('refresh preserves the scroll position', async ({ page }) => {
        await page.goto(`${BASE_URL}/docs`, { waitUntil: 'networkidle' });
        await page.evaluate(() => window.scrollTo(0, 1200));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);

        await page.reload({ waitUntil: 'networkidle' });

        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1200);
    });
});
