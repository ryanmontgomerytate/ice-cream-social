import { test, expect } from '@playwright/test';

test('harness page loads', async ({ page }) => {
  await page.goto('/e2e-voice-flow.html');
  await expect(page).toHaveTitle(/Voice Flow E2E Harness/);
});
