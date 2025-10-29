import { expect, test } from '@playwright/test';

test.describe('Document Editor', () => {
  test('opens document viewer modal', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');
    
    // Wait for loading to finish
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });
    
    // Wait for document list to load
    await page.waitForSelector('[data-testid="docs-navigator__list"]', { timeout: 5000 });
    
    // Click on first document to select it
    const firstDoc = page.getByTestId('docs-navigator__list').locator('li').first();
    await firstDoc.click();
    
    // Click on "ドキュメントを開く" button
    await page.getByTestId('docs-navigator__open-document-button').click();
    
    // Verify modal is open
    await expect(page.getByTestId('document-viewer__overlay')).toBeVisible();
    await expect(page.getByTestId('document-viewer__modal')).toBeVisible();
    
    // Verify document content is loaded
    await expect(page.getByTestId('document-viewer__pre')).toBeVisible();
    
    // Close modal
    await page.getByTestId('document-viewer__close-button').click();
    
    // Verify modal is closed
    await expect(page.getByTestId('document-viewer__overlay')).not.toBeVisible();
  });
  
  test('switches to edit mode and back', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');
    
    // Wait for loading to finish
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });
    
    // Wait for document list
    await page.waitForSelector('[data-testid="docs-navigator__list"]', { timeout: 5000 });
    
    // Click on first document
    const firstDoc = page.getByTestId('docs-navigator__list').locator('li').first();
    await firstDoc.click();
    
    // Open document viewer
    await page.getByTestId('docs-navigator__open-document-button').click();
    
    // Wait for modal to open
    await expect(page.getByTestId('document-viewer__modal')).toBeVisible();
    
    // Wait for content to load
    await page.waitForSelector('[data-testid="document-viewer__pre"]', { timeout: 5000 });
    
    // Click edit button
    await page.getByTestId('document-viewer__edit-button').click();
    
    // Verify edit mode
    await expect(page.getByTestId('document-viewer__textarea')).toBeVisible();
    await expect(page.getByTestId('document-viewer__edit-badge')).toBeVisible();
    
    // Cancel edit
    await page.getByTestId('document-viewer__cancel-edit-button').click();
    
    // Verify back to view mode
    await expect(page.getByTestId('document-viewer__pre')).toBeVisible();
    await expect(page.getByTestId('document-viewer__edit-badge')).not.toBeVisible();
    
    // Close modal
    await page.getByTestId('document-viewer__close-button').click();
  });
  
  test('copies prompt to clipboard', async ({ page }) => {
    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    
    // Navigate to homepage
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');
    
    // Wait for loading to finish
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });
    
    // Wait for document list
    await page.waitForSelector('[data-testid="docs-navigator__list"]', { timeout: 5000 });
    
    // Click on first document
    const firstDoc = page.getByTestId('docs-navigator__list').locator('li').first();
    await firstDoc.click();
    
    // Open document viewer
    await page.getByTestId('docs-navigator__open-document-button').click();
    
    // Wait for modal to open
    await expect(page.getByTestId('document-viewer__modal')).toBeVisible();
    
    // Wait for content to load
    await page.waitForSelector('[data-testid="document-viewer__pre"]', { timeout: 5000 });
    
    // Click prompt generation button
    await page.getByTestId('document-viewer__copy-prompt-button').click();
    
    // Verify success message
    await expect(page.getByTestId('document-viewer__message-success')).toBeVisible();
    await expect(page.getByTestId('document-viewer__message-success')).toContainText('プロンプトをコピーしました');
    
    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('以下のドキュメントを修正してください');
    expect(clipboardText).toContain('ドキュメント情報');
    expect(clipboardText).toContain('注意事項');
    
    // Close modal
    await page.getByTestId('document-viewer__close-button').click();
  });
  
  test('closes modal with ESC key', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');
    
    // Wait for loading to finish
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });
    
    // Wait for document list
    await page.waitForSelector('[data-testid="docs-navigator__list"]', { timeout: 5000 });
    
    // Click on first document
    const firstDoc = page.getByTestId('docs-navigator__list').locator('li').first();
    await firstDoc.click();
    
    // Open document viewer
    await page.getByTestId('docs-navigator__open-document-button').click();
    
    // Wait for modal to open
    await expect(page.getByTestId('document-viewer__modal')).toBeVisible();
    
    // Wait for content to load
    await page.waitForSelector('[data-testid="document-viewer__pre"]', { timeout: 5000 });
    
    // Press ESC key
    await page.keyboard.press('Escape');
    
    // Verify modal is closed
    await expect(page.getByTestId('document-viewer__overlay')).not.toBeVisible();
  });
  
  test('shows dirty badge when editing', async ({ page }) => {
    // Navigate to homepage
    await page.goto('/');
    
    // Click on Docs tab
    await page.click('a[href="#docs"]');
    
    // Wait for loading to finish
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });
    
    // Wait for document list
    await page.waitForSelector('[data-testid="docs-navigator__list"]', { timeout: 5000 });
    
    // Click on first document
    const firstDoc = page.getByTestId('docs-navigator__list').locator('li').first();
    await firstDoc.click();
    
    // Open document viewer
    await page.getByTestId('docs-navigator__open-document-button').click();
    
    // Wait for modal to open
    await expect(page.getByTestId('document-viewer__modal')).toBeVisible();
    
    // Wait for content to load
    await page.waitForSelector('[data-testid="document-viewer__pre"]', { timeout: 5000 });
    
    // Click edit button
    await page.getByTestId('document-viewer__edit-button').click();
    
    // Wait for textarea
    await expect(page.getByTestId('document-viewer__textarea')).toBeVisible();
    
    // Type something to make it dirty
    await page.getByTestId('document-viewer__textarea').fill('test content');
    
    // Verify dirty badge appears
    await expect(page.getByTestId('document-viewer__dirty-badge')).toBeVisible();
    await expect(page.getByTestId('document-viewer__dirty-badge')).toContainText('未保存');
    
    // Cancel edit (will prompt for confirmation)
    page.on('dialog', dialog => dialog.accept());
    await page.getByTestId('document-viewer__cancel-edit-button').click();
  });
});

