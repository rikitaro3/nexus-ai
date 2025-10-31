import { parseFeatRegistry, searchByFeatId, type FeatureRecord } from '../featRegistry';

describe('featRegistry utilities', () => {
  const sampleTable = `## FEAT一覧（機能）

|| FEAT-ID | 機能名 | REQ-ID | FR-ID範囲 | FR数 | 優先度 | ステータス |
|---------|--------|--------|-----------|------|--------|-----------|
| FEAT-001 | Docs Navigator | REQ-001 | FR-001〜FR-006 | 6 | High | 実装中 |
| FEAT-002 | Tasks | REQ-002 | FR-007〜FR-011 | 5 | High | 実装中 |
| FEAT-003 | Quality Gates | REQ-003 | FR-012〜FR-016 | 5 | High | 実装中 |
| FEAT-015 | プロンプト生成補助機能 | REQ-002 | FR-047〜FR-049 | 3 | High | 実装中 |
| FEAT-021 | ドキュメントビューア | REQ-001 | FR-050〜FR-051 | 2 | High | 未実装 |

**集計**:`;

  describe('parseFeatRegistry', () => {
    it('should extract feature records from markdown table', () => {
      const records = parseFeatRegistry(sampleTable);

      expect(records).toHaveLength(5);
      expect(records[0]).toEqual({
        id: 'FEAT-001',
        name: 'Docs Navigator',
        reqId: 'REQ-001',
        frRange: 'FR-001〜FR-006',
        frCount: 6,
        priority: 'High',
        status: '実装中',
      });
    });

    it('should ignore malformed rows', () => {
      const malformed = `${sampleTable}\n| Invalid | row |`;
      const records = parseFeatRegistry(malformed);

      expect(records).toHaveLength(5);
    });

    it('should return empty array when table is missing', () => {
      expect(parseFeatRegistry('# No table')).toEqual([]);
    });
  });

  describe('searchByFeatId', () => {
    let records: FeatureRecord[];

    beforeEach(() => {
      records = parseFeatRegistry(sampleTable);
    });

    it('should return all records when query is empty', () => {
      expect(searchByFeatId(records, '')).toEqual(records);
    });

    it('should filter by FEAT-ID', () => {
      const result = searchByFeatId(records, 'FEAT-002');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('FEAT-002');
    });

    it('should filter by name and REQ-ID', () => {
      expect(searchByFeatId(records, 'navigator')).toHaveLength(1);
      expect(searchByFeatId(records, 'REQ-002')).toHaveLength(2);
    });
  });
});
