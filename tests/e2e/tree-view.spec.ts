import { expect, test } from '@playwright/test';

test.describe('Tree View', () => {
  test('should display document tree with hierarchy', async ({ page }) => {
    // Navigate to homepage and click on Docs tab
    await page.goto('/#docs');
    await page.waitForLoadState('networkidle');
    
    // Wait for context to load
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached', timeout: 10000 });
    
    // Click on Tree mode button
    console.log('Switching to Tree mode');
    await page.click('[data-testid="docs-navigator__mode-tree-button"]');
    
    // Wait for tree mode to be active
    await page.waitForSelector('[data-testid="docs-navigator__mode-tree"]', { state: 'visible' });
    
    // Wait for tree data to load
    await page.waitForTimeout(2000);
    
    // Check if tree view is visible
    const treeView = page.getByTestId('docs-navigator__tree-view');
    await expect(treeView).toBeVisible();
    
    // Check if root nodes are displayed
    const treeNodes = page.locator('[data-testid^="tree-node-"]');
    const nodeCount = await treeNodes.count();
    console.log('Tree nodes count:', nodeCount);
    expect(nodeCount).toBeGreaterThan(0);
    
    // Take screenshot
    await page.screenshot({ path: 'test-results/tree-view-initial.png', fullPage: true });
  });

  test('should expand and collapse tree nodes', async ({ page }) => {
    await page.goto('/#docs');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached' });
    
    // Switch to Tree mode
    await page.click('[data-testid="docs-navigator__mode-tree-button"]');
    await page.waitForSelector('[data-testid="docs-navigator__mode-tree"]');
    await page.waitForTimeout(2000);
    
    // Find a node with children (look for ▶ icon)
    const expandableNode = page.locator('.tree-icon').first();
    const initialIcon = await expandableNode.textContent();
    console.log('Initial icon:', initialIcon);
    
    if (initialIcon === '▶') {
      // Click to expand
      await expandableNode.click();
      await page.waitForTimeout(300);
      
      // Check if icon changed to ▼
      const expandedIcon = await expandableNode.textContent();
      console.log('Expanded icon:', expandedIcon);
      expect(expandedIcon).toBe('▼');
      
      // Click again to collapse
      await expandableNode.click();
      await page.waitForTimeout(300);
      
      // Check if icon changed back to ▶
      const collapsedIcon = await expandableNode.textContent();
      expect(collapsedIcon).toBe('▶');
    }
  });

  test('should display orphan documents', async ({ page }) => {
    await page.goto('/#docs');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached' });
    
    // Switch to Tree mode
    await page.click('[data-testid="docs-navigator__mode-tree-button"]');
    await page.waitForSelector('[data-testid="docs-navigator__mode-tree"]');
    await page.waitForTimeout(2000);
    
    // Check if orphans section exists
    const orphansSection = page.getByTestId('docs-navigator__orphans');
    
    // Orphans might or might not exist depending on the data
    const orphansExists = await orphansSection.isVisible().catch(() => false);
    console.log('Orphans section exists:', orphansExists);
    
    if (orphansExists) {
      // Check orphans title
      const orphansTitle = page.locator('.tree-orphans-title');
      const titleText = await orphansTitle.textContent();
      console.log('Orphans title:', titleText);
      expect(titleText).toContain('Orphans');
      
      // Check orphan items
      const orphanItems = page.locator('[data-testid^="orphan-"]');
      const orphanCount = await orphanItems.count();
      console.log('Orphan count:', orphanCount);
      expect(orphanCount).toBeGreaterThan(0);
    }
  });

  test('should display document details when node is selected', async ({ page }) => {
    await page.goto('/#docs');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached' });
    
    // Switch to Tree mode
    await page.click('[data-testid="docs-navigator__mode-tree-button"]');
    await page.waitForSelector('[data-testid="docs-navigator__mode-tree"]');
    await page.waitForTimeout(2000);
    
    // Click on first tree node
    const firstNode = page.locator('[data-testid^="tree-node-"]').first();
    await firstNode.click();
    
    // Wait for detail panel
    await page.waitForTimeout(500);
    
    // Check if detail content is displayed
    const detailContent = page.getByTestId('docs-navigator__tree-detail-content');
    await expect(detailContent).toBeVisible();
    
    // Check if path is displayed
    await expect(detailContent).toContainText('Path:');
    
    // Check if layer is displayed
    await expect(detailContent).toContainText('Layer:');
    
    // Check if title is displayed
    await expect(detailContent).toContainText('Title:');
    
    // Take screenshot
    await page.screenshot({ path: 'test-results/tree-view-detail.png', fullPage: true });
  });

  test('should handle tree loading and display correctly', async ({ page }) => {
    // Collect console logs
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[TreeView]')) {
        consoleLogs.push(text);
        console.log('[Browser]', text);
      }
    });
    
    await page.goto('/#docs');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="docs-navigator__loading"]', { state: 'detached' });
    
    // Switch to Tree mode
    await page.click('[data-testid="docs-navigator__mode-tree-button"]');
    await page.waitForSelector('[data-testid="docs-navigator__mode-tree"]');
    await page.waitForTimeout(3000);
    
    // Log all TreeView console messages
    console.log('\n=== TreeView Console Logs ===');
    consoleLogs.forEach((log, i) => console.log(`${i + 1}. ${log}`));
    
    // Verify logs indicate successful loading
    const hasLoadingLog = consoleLogs.some(log => log.includes('Loading document metadata'));
    const hasLoadedLog = consoleLogs.some(log => log.includes('Loaded metadata for'));
    const hasTreeLog = consoleLogs.some(log => log.includes('Built tree with'));
    
    expect(hasLoadingLog).toBe(true);
    expect(hasLoadedLog).toBe(true);
    expect(hasTreeLog).toBe(true);
  });
});

