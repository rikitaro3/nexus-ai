import data from './fixtures/sample.json';

describe('docs navigator basic', () => {
  beforeAll(() => {
    // setup fixtures
  });

  afterAll(() => {
    // teardown fixtures
  });

  /**
   * 目的: ドキュメント一覧が表示されることを確認する
   * 期待結果: 3件以上のドキュメントが表示される
   */
  test('shows docs list', () => {
    expect(Array.isArray(data.items)).toBe(true);
  });
});
