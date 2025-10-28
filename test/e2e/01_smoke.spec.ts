import path from 'path';
import { test, expect } from '@playwright/test';

const TREE_READY_MESSAGE = 'Tree view ready';

test.describe('Nexus smoke test', () => {
  test('renders tree view in demo fixture', async ({ page }) => {
    const fileUrl = 'file://' + path.resolve(__dirname, './fixtures/smoke.html');

    await page.goto(fileUrl);
    await expect(page.getByTestId('docs-navigator__heading')).toBeVisible();

    const treeButton = page.getByTestId('docs-navigator__mode-tree-button');
    await expect(treeButton).toBeVisible();

    await treeButton.click();

    const status = page.getByTestId('docs-navigator__tree-status');
    await expect(status).toHaveText(TREE_READY_MESSAGE);

    const treeView = page.getByTestId('docs-navigator__tree-node');
    await expect(treeView.first()).toHaveText('Root Node');
  });
});
