const tasks = require('../tasks');

const {
  applyTaskDefaults,
  parsePasted,
  buildBreakdownPrompt,
} = tasks as {
  applyTaskDefaults: (raw?: Record<string, unknown>) => Record<string, unknown>;
  parsePasted: (text: string, options?: { uidFn?: () => string; timestampFn?: () => string }) => Record<string, unknown>[];
  buildBreakdownPrompt: (input: { title: string; category: string; priority: string; featId?: string; links?: Record<string, string> }) => string;
};

describe('tasks helpers', () => {
  describe('applyTaskDefaults', () => {
    it('fills missing breakdown metadata with defaults', () => {
      const result = applyTaskDefaults({ title: 'Example Task' });
      expect(result).toMatchObject({
        title: 'Example Task',
        notes: '',
        breakdownPrompt: '',
        breakdownStatus: 'DRAFT',
        lastBreakdownAt: '',
      });
    });

    it('preserves provided breakdown metadata', () => {
      const now = '2025-02-01T10:00:00.000Z';
      const result = applyTaskDefaults({
        notes: 'Keep me',
        breakdownPrompt: 'Existing prompt',
        breakdownStatus: 'READY',
        lastBreakdownAt: now,
      });
      expect(result).toMatchObject({
        notes: 'Keep me',
        breakdownPrompt: 'Existing prompt',
        breakdownStatus: 'READY',
        lastBreakdownAt: now,
      });
    });
  });

  describe('parsePasted', () => {
    it('creates normalized task entries for pasted lines', () => {
      const timestamp = '2025-03-10T09:30:00.000Z';
      const tasksFromPaste = parsePasted('【Backend】 Implement API', {
        uidFn: () => 'Tcustom123',
        timestampFn: () => timestamp,
      });

      expect(tasksFromPaste).toHaveLength(1);
      expect(tasksFromPaste[0]).toMatchObject({
        id: 'Tcustom123',
        title: 'Implement API',
        category: 'Backend',
        priority: 'MEDIUM',
        status: 'TODO',
        featId: '',
        links: {},
        notes: '',
        breakdownPrompt: '',
        breakdownStatus: 'DRAFT',
        lastBreakdownAt: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    it('defaults to Uncategorized when no bracketed category is present', () => {
      const tasksFromPaste = parsePasted('Investigate flaky tests', {
        uidFn: () => 'Tother',
        timestampFn: () => '2025-03-11T00:00:00.000Z',
      });

      expect(tasksFromPaste[0]).toMatchObject({
        id: 'Tother',
        title: 'Investigate flaky tests',
        category: 'Uncategorized',
      });
    });
  });

  describe('buildBreakdownPrompt', () => {
    it('includes task context and links in the generated prompt', () => {
      const prompt = buildBreakdownPrompt({
        title: 'Implement login flow',
        category: 'Frontend',
        priority: 'HIGH',
        featId: 'FEAT-1234',
        links: {
          PRD: 'docs/prd/login',
          UX: 'docs/ux/login',
        },
      });

      expect(prompt).toContain('Implement login flow');
      expect(prompt).toContain('カテゴリ: Frontend');
      expect(prompt).toContain('優先度: HIGH');
      expect(prompt).toContain('FEAT: FEAT-1234');
      expect(prompt).toContain('- PRD: docs/prd/login');
      expect(prompt).toContain('- UX: docs/ux/login');
    });

    it('indicates when no related documents exist', () => {
      const prompt = buildBreakdownPrompt({
        title: 'Research spike',
        category: 'Discovery',
        priority: 'LOW',
        featId: '',
      });

      expect(prompt).toContain('- 関連ドキュメント:');
      expect(prompt).toContain('- (なし)');
    });
  });
});
