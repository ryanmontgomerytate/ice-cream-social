import { test, expect } from '@playwright/test';

test.describe('Voice Sample + Voiceprint Flow (UI Harness)', () => {
  test('adds sample and reflects voiceprint in library', async ({ page }) => {
    await page.goto('/e2e-voice-flow.html');

    await expect(page.getByText('Voice Flow E2E Harness')).toBeVisible();
    await expect(page.locator('#mode')).toContainText('tauri-mock');

    await page.getByRole('button', { name: 'Save Voice Sample' }).click();
    await expect(page.locator('#output')).toContainText('"saved": 1');

    await page.getByRole('button', { name: 'Refresh Voice Library' }).click();
    await expect(page.locator('#output')).toContainText('Matt Donnelly');
    await expect(page.locator('#output')).toContainText('"sample_count": 1');
    await expect(page.locator('#output')).toContainText('"has_embedding": true');
  });
});
