import { expect, test } from '@playwright/test';

test.describe('Docs Navigator', () => {
  test('loads YAML context map and displays all categories', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');
    
    // Wait for loading to finish
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });

    // Check that categories are loaded
    const categories = page.getByTestId('docs-navigator__category-list').locator('li');
    const categoryCount = await categories.count();
    console.log('Category count:', categoryCount);
    
    // Should have 6 categories: INDEX, PRD, ARCH, DEVELOPMENT, QA, GATES
    expect(categoryCount).toBe(6);
    
    // Verify all expected categories are present
    await expect(page.getByTestId('docs-navigator__category-list')).toContainText('INDEX');
    await expect(page.getByTestId('docs-navigator__category-list')).toContainText('PRD');
    await expect(page.getByTestId('docs-navigator__category-list')).toContainText('ARCH');
    await expect(page.getByTestId('docs-navigator__category-list')).toContainText('DEVELOPMENT');
    await expect(page.getByTestId('docs-navigator__category-list')).toContainText('QA');
    await expect(page.getByTestId('docs-navigator__category-list')).toContainText('GATES');
  });

  test('loads context map and supports filtering', async ({ page }) => {
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');

    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached' });

    const categories = page.getByTestId('docs-navigator__category-list').locator('li');
    const categoryCount = await categories.count();
    expect(categoryCount).toBeGreaterThanOrEqual(3);

    await expect(page.getByTestId('docs-navigator__detail')).toContainText('docs/index.mdc');

    await page.getByTestId('docs-navigator__category-list').getByText('PRD').click();
    await expect(page.getByTestId('docs-navigator__detail')).toContainText('docs/PRD/index.mdc');

    const searchInput = page.getByLabel('ドキュメント検索');
    await searchInput.fill('template');

    const listItems = page.getByTestId('docs-navigator__list').locator('li');
    await expect(listItems).toHaveCount(1);
    await listItems.first().click();
    await expect(page.getByTestId('docs-navigator__detail')).toContainText('PRD_DocumentTemplate');

    await searchInput.fill('');
    const prdCount = await page.getByTestId('docs-navigator__list').locator('li').count();
    expect(prdCount).toBeGreaterThanOrEqual(3);

    await page.getByTestId('docs-navigator__mode-feats-button').click();
    await expect(page.getByTestId('docs-navigator__mode-feats')).toBeVisible();

    await page.getByTestId('docs-navigator__mode-tree-button').click();
    await expect(page.getByTestId('docs-navigator__mode-tree')).toBeVisible();

    await page.getByTestId('docs-navigator__mode-docs-button').click();
    await expect(page.getByTestId('docs-navigator__mode-docs')).toBeVisible();
  });
});
