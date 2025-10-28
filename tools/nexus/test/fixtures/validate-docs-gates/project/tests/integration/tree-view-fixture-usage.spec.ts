describe('tree view fixture usage', () => {
  /**
   * 目的: フィクスチャを利用できること
   * 期待結果: データがロードされる
   */
  test('loads fixtures', () => {
    const data = require('./fixtures/data.json');
    expect(data).toBeDefined();
  });
});
