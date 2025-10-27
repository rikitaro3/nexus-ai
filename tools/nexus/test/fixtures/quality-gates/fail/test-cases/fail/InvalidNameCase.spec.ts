import payload from '../fixtures/sample.json';

describe('invalid name case', () => {
  beforeAll(() => {
    // setup fixtures
  });

  afterAll(() => {
    // teardown fixtures
  });

  /**
   * 目的: ファイル名の命名規則違反を検出する
   * 期待結果: DOC ツールが TC-01 を報告する
   */
  test('runs with invalid file name', () => {
    expect(payload.items.length).toBe(2);
  });
});
