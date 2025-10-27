import dataset from '../fixtures/sample.json';

describe('docs navigator dependent', () => {
  let state = 0;

  beforeAll(() => {
    state = dataset.items.length;
  });

  afterAll(() => {
    state = 0;
  });

  /**
   * 目的: 依存関係のあるテストの起点
   * 期待結果: 初回テストが成功する
   */
  const first = test('initialises state', async () => {
    expect(state).toBeGreaterThan(0);
  });

  /**
   * 目的: 別テストの結果に依存する挙動を検出
   * 期待結果: 依存が検出される
   */
  test('depends on previous test', () => {
    return first.then(() => {
      expect(state).toBeGreaterThan(0);
    });
  });
});
