import sample from '../fixtures/sample.json';

describe('docs navigator undocumented', () => {
  beforeAll(() => {
    // setup fixtures
  });

  afterAll(() => {
    // teardown fixtures
  });

  test('renders list', () => {
    expect(sample.items.length).toBeGreaterThan(0);
  });

  test('filters items', () => {
    expect(sample.items.includes('alpha')).toBe(false);
  });
});
