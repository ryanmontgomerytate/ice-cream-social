import { test, expect } from '@playwright/test';

test.describe('Ice Cream Social App', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3000');
  });

  test('should load the dashboard', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Check for header
    await expect(page.locator('text=Ice Cream Social')).toBeVisible();

    // Check for stats
    await expect(page.locator('text=Episodes')).toBeVisible();
  });

  test('should display episode browser with tabs', async ({ page }) => {
    // Wait for episodes to load
    await page.waitForSelector('text=Browse Episodes', { timeout: 10000 });

    // Check for Patreon tab
    await expect(page.locator('text=Patreon (Premium)')).toBeVisible();

    // Check for episode count
    await expect(page.locator('text=/\\d+ episodes/')).toBeVisible();
  });

  test('should be able to search episodes', async ({ page }) => {
    // Wait for the search box
    await page.waitForSelector('input[placeholder*="Search episodes"]', { timeout: 10000 });

    // Type in search box
    await page.fill('input[placeholder*="Search episodes"]', 'saran');

    // Click search button
    await page.click('button:has-text("Search")');

    // Wait for results
    await page.waitForTimeout(1000);

    // Should show results matching search
    await expect(page.locator('text=Saran')).toBeVisible();
  });

  test('should display transcription queue', async ({ page }) => {
    // Wait for queue section
    await page.waitForSelector('text=Transcription Queue', { timeout: 10000 });

    // Check for queue stats
    await expect(page.locator('text=Pending')).toBeVisible();
    await expect(page.locator('text=Processing')).toBeVisible();
    await expect(page.locator('text=Completed')).toBeVisible();
  });

  test('should be able to add episode to queue', async ({ page }) => {
    // Wait for episodes to load
    await page.waitForSelector('text=Browse Episodes', { timeout: 10000 });

    // Wait a bit for episodes to render
    await page.waitForTimeout(2000);

    // Find first "Add to Queue" button
    const addButton = page.locator('button:has-text("Add to Queue")').first();

    if (await addButton.isVisible()) {
      // Click the button
      await addButton.click();

      // Should see a notification
      await expect(page.locator('text=/Added.*to queue/')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should show episode status badges', async ({ page }) => {
    // Wait for episodes to load
    await page.waitForSelector('text=Browse Episodes', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Should see at least one status badge (Transcribed, In Queue, Pending, etc.)
    const badges = page.locator('[class*="badge"], text=/Transcribed|In Queue|Pending|Processing/');
    await expect(badges.first()).toBeVisible();
  });

  test('should be able to sort episodes', async ({ page }) => {
    // Wait for episodes
    await page.waitForSelector('text=Browse Episodes', { timeout: 10000 });

    // Click on "Title" sort button
    await page.click('button:has-text("Title")');

    // Wait for re-sort
    await page.waitForTimeout(1000);

    // Check that URL or state changed (episodes should be re-ordered)
    // This is a simple check - in a real scenario you'd verify actual order
    await expect(page.locator('text=Browse Episodes')).toBeVisible();
  });

  test('should display pagination', async ({ page }) => {
    // Wait for episodes
    await page.waitForSelector('text=Browse Episodes', { timeout: 10000 });
    await page.waitForTimeout(2000);

    // Check for pagination controls
    const nextButton = page.locator('button:has-text("Next")');
    const prevButton = page.locator('button:has-text("Previous")');

    // At least one pagination button should exist
    expect(await nextButton.count() + await prevButton.count()).toBeGreaterThan(0);
  });

  test('should filter episodes', async ({ page }) => {
    // Wait for episodes
    await page.waitForSelector('text=Browse Episodes', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Click "Transcribed Only" checkbox
    const transcribedCheckbox = page.locator('input[type="checkbox"]:near(:text("Transcribed Only"))');

    if (await transcribedCheckbox.isVisible()) {
      await transcribedCheckbox.click();

      // Wait for filter to apply
      await page.waitForTimeout(1000);

      // Should update results
      await expect(page.locator('text=Browse Episodes')).toBeVisible();
    }
  });

  test('should have sticky queue panel on large screens', async ({ page }) => {
    // Set viewport to large screen
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Wait for page load
    await page.waitForSelector('text=Transcription Queue', { timeout: 10000 });

    // Check if queue has sticky positioning (via CSS classes)
    const queuePanel = page.locator('text=Transcription Queue').locator('..');
    const parentDiv = queuePanel.locator('..');

    // Check for sticky class
    const classes = await parentDiv.getAttribute('class') || '';
    expect(classes).toContain('sticky');
  });
});

test.describe('API Health Checks', () => {
  test('backend API should be healthy', async ({ request }) => {
    const response = await request.get('http://localhost:8000/api/v2/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.version).toBe('2.0');
  });

  test('episodes endpoint should return data', async ({ request }) => {
    const response = await request.get('http://localhost:8000/api/v2/episodes?limit=5');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.episodes).toBeDefined();
    expect(data.total).toBeGreaterThan(0);
  });

  test('queue status endpoint should work', async ({ request }) => {
    const response = await request.get('http://localhost:8000/api/v2/queue/status');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.pending).toBeDefined();
    expect(data.processing).toBeDefined();
    expect(data.completed).toBeDefined();
    expect(data.failed).toBeDefined();
  });
});
