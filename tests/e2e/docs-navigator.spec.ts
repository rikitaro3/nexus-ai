import { expect, test } from '@playwright/test';

test.describe('Docs Navigator', () => {
  test('loads context map and supports filtering', async ({ page }) => {
    await page.goto('/');

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
