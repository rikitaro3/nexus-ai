import { expect, test } from '@playwright/test';

test.describe('Docs Navigator - Detailed Debugging', () => {
  test('should load context.mdc and display categories with detailed logs', async ({ page }) => {
    // Collect console logs
    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];
    
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      console.log('[Browser Console]', text);
    });
    
    page.on('pageerror', error => {
      const text = error.message;
      consoleErrors.push(text);
      console.error('[Browser Error]', text);
    });

    // Navigate to homepage
    console.log('Step 1: Navigating to homepage');
    await page.goto('/');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    console.log('Step 2: Page loaded');

    // Check if header is visible
    const header = page.locator('header');
    await expect(header).toBeVisible();
    console.log('Step 3: Header is visible');

    // Check if Docs link exists in header
    const docsLink = page.locator('a[href="#docs"]');
    await expect(docsLink).toBeVisible();
    console.log('Step 4: Docs link is visible');

    // Click on Docs link
    console.log('Step 5: Clicking on Docs link');
    await docsLink.click();
    
    // Wait a bit for hash change to take effect
    await page.waitForTimeout(500);
    
    // Check current URL hash
    const currentHash = await page.evaluate(() => window.location.hash);
    console.log('Step 6: Current hash:', currentHash);
    expect(currentHash).toBe('#docs');

    // Check if DocsNavigator section is visible
    const docsSection = page.getByTestId('docs-navigator__section');
    await expect(docsSection).toBeVisible({ timeout: 5000 });
    console.log('Step 7: DocsNavigator section is visible');

    // Check for loading indicator
    const loadingIndicator = page.getByTestId('docs-navigator__loading');
    console.log('Step 8: Checking for loading indicator');
    
    // Wait for loading to disappear
    await loadingIndicator.waitFor({ state: 'detached', timeout: 10000 });
    console.log('Step 9: Loading finished');

    // Wait a bit to ensure state updates
    await page.waitForTimeout(1000);

    // Check if categories are displayed
    const categoryList = page.getByTestId('docs-navigator__category-list');
    await expect(categoryList).toBeVisible();
    console.log('Step 10: Category list is visible');

    const categories = categoryList.locator('li');
    const categoryCount = await categories.count();
    console.log('Step 11: Category count:', categoryCount);

    // Take screenshot for visual inspection
    await page.screenshot({ path: 'test-results/docs-navigator-state.png', fullPage: true });
    
    // Log all console messages
    console.log('\n=== All Browser Console Logs ===');
    consoleLogs.forEach((log, i) => console.log(`${i + 1}. ${log}`));
    
    if (consoleErrors.length > 0) {
      console.log('\n=== Browser Errors ===');
      consoleErrors.forEach((error, i) => console.error(`${i + 1}. ${error}`));
    }

    // Assertions
    expect(categoryCount).toBeGreaterThan(0);
    expect(categoryCount).toBe(6);
    
    // Verify specific categories
    await expect(categoryList).toContainText('INDEX');
    await expect(categoryList).toContainText('PRD');
    await expect(categoryList).toContainText('ARCH');
    await expect(categoryList).toContainText('DEVELOPMENT');
    await expect(categoryList).toContainText('QA');
    await expect(categoryList).toContainText('GATES');
    
    console.log('Step 12: All categories verified');

    // Check if list items are displayed
    const listSection = page.getByTestId('docs-navigator__list');
    await expect(listSection).toBeVisible();
    
    const listItems = listSection.locator('li');
    const listCount = await listItems.count();
    console.log('Step 13: List items count:', listCount);
    expect(listCount).toBeGreaterThan(0);

    // Check detail section
    const detailSection = page.getByTestId('docs-navigator__detail');
    await expect(detailSection).toBeVisible();
    console.log('Step 14: Detail section is visible');
    
    // Get detail content
    const detailContent = await detailSection.textContent();
    console.log('Step 15: Detail content:', detailContent);

    console.log('\n=== Test Completed Successfully ===');
  });

  test('should verify context.mdc is accessible', async ({ page }) => {
    // Intercept network requests
    const requests: { url: string; status: number }[] = [];
    
    page.on('response', response => {
      if (response.url().includes('context.mdc')) {
        requests.push({
          url: response.url(),
          status: response.status(),
        });
        console.log('[Network] context.mdc request:', response.status(), response.url());
      }
    });

    await page.goto('/');
    
    // Try to fetch context.mdc directly
    const response = await page.goto('/context.mdc');
    console.log('Direct access to /context.mdc:', response?.status());
    
    if (response) {
      const contentType = response.headers()['content-type'];
      console.log('Content-Type:', contentType);
      
      const text = await response.text();
      console.log('Content length:', text.length);
      console.log('Content preview:', text.substring(0, 200));
      
      expect(response.status()).toBe(200);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('version');
      expect(text).toContain('contextMap');
    }

    console.log('\n=== All context.mdc requests ===');
    requests.forEach((req, i) => console.log(`${i + 1}. ${req.status} ${req.url}`));
  });

  test('should test hash navigation directly', async ({ page }) => {
    console.log('Testing direct hash navigation');
    
    // Navigate directly to #docs
    await page.goto('/#docs');
    await page.waitForLoadState('networkidle');
    
    const hash = await page.evaluate(() => window.location.hash);
    console.log('Current hash:', hash);
    expect(hash).toBe('#docs');
    
    // Check if DocsNavigator is rendered
    const docsSection = page.getByTestId('docs-navigator__section');
    await expect(docsSection).toBeVisible({ timeout: 5000 });
    console.log('DocsNavigator is rendered');
    
    // Wait for loading to finish
    await page.getByTestId('docs-navigator__loading').waitFor({ state: 'detached', timeout: 10000 });
    console.log('Loading finished');
    
    // Check categories
    const categories = page.getByTestId('docs-navigator__category-list').locator('li');
    const count = await categories.count();
    console.log('Category count:', count);
    
    await page.screenshot({ path: 'test-results/direct-hash-navigation.png', fullPage: true });
    
    expect(count).toBe(6);
  });
});

