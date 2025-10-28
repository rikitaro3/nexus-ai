import { expect, test } from '@playwright/test';

test.describe('App Shell', () => {
  test('tabs allow switching between Docs, Tasks, and Settings', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached' });

    await expect(page.getByTestId('app-shell__tab-docs')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('docs-navigator__heading')).toBeVisible();

    await page.getByTestId('app-shell__tab-tasks').click();
    await expect(page.getByTestId('app-shell__tab-tasks')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tasks__heading')).toBeVisible();
    await expect(page.getByTestId('tasks__list-empty')).toBeVisible();

    await page.getByTestId('app-shell__tab-settings').click();
    await expect(page.getByTestId('app-shell__tab-settings')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('settings__heading')).toBeVisible();

    const toggleButton = page.getByTestId('settings__toggle-theme-button');
    await expect(toggleButton).toContainText('ダークモード');
    await toggleButton.click();
    await expect(toggleButton).toContainText('ライトモード');
    await toggleButton.click();
    await expect(toggleButton).toContainText('ダークモード');
  });
});
