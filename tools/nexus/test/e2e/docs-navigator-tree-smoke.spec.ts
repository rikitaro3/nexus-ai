import path from 'path';
import { test, expect } from '@playwright/test';

let treeFixtureUrl: string;

test.beforeAll(() => {
  treeFixtureUrl = 'file://' + path.resolve(__dirname, './fixtures/smoke.html');
});

test.afterAll(() => {
  treeFixtureUrl = '';
});

test.describe('Docs Navigator tree smoke', () => {
  /**
   * 目的: Docs Navigator のツリー表示がデモフィクスチャで描画されることを確認する
   * 期待結果: ツリーモードを開くとルートノードとステータスが表示される
   */
  test('renders tree view from demo fixture', async ({ page }) => {
    await page.goto(treeFixtureUrl);

    await expect(page.locator('text=Docs Navigator')).toBeVisible();

    const treeButton = page.locator('button[data-mode="tree"]');
    await expect(treeButton).toBeVisible();
    await treeButton.click();

    const status = page.locator('#tree-status');
    await expect(status).toHaveText('Tree view ready');

    const treeView = page.locator('#tree-view .tree-node');
    await expect(treeView.first()).toHaveText('Root Node');
  });
});
