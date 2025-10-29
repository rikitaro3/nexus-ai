import { parseContextEntries } from '../DocsNavigator';

describe('parseContextEntries', () => {
  describe('YAML format', () => {
    it('should parse valid YAML context with single entry', () => {
      const yamlContent = `version: "1.0"
contextMap:
  - category: "TEST"
    entries:
      - path: "test.mdc"
        description: "Test doc"`;
      
      const entries = parseContextEntries(yamlContent);
      
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        category: 'TEST',
        path: 'test.mdc',
        description: 'Test doc',
      });
    });

    it('should parse YAML context with multiple categories', () => {
      const yamlContent = `version: "1.0"
contextMap:
  - category: "PRD"
    entries:
      - path: "docs/PRD/index.mdc"
        description: "Features Registry"
      - path: "docs/PRD/spec.mdc"
        description: "Specification"
  - category: "ARCH"
    entries:
      - path: "docs/ARCH/design.mdc"
        description: "Design document"`;
      
      const entries = parseContextEntries(yamlContent);
      
      expect(entries).toHaveLength(3);
      expect(entries[0].category).toBe('PRD');
      expect(entries[1].category).toBe('PRD');
      expect(entries[2].category).toBe('ARCH');
    });

    it('should handle empty entries array', () => {
      const yamlContent = `version: "1.0"
contextMap:
  - category: "EMPTY"
    entries: []`;
      
      const entries = parseContextEntries(yamlContent);
      
      expect(entries).toHaveLength(0);
    });
  });

  describe('Markdown format fallback', () => {
    it('should parse Markdown format', () => {
      const mdContent = `## Context Map

### TEST
- test.mdc … Test doc
- another.mdc … Another doc

### ARCH
- arch.mdc … Architecture`;
      
      const entries = parseContextEntries(mdContent);
      
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({
        category: 'TEST',
        path: 'test.mdc',
        description: 'Test doc',
      });
      expect(entries[1]).toEqual({
        category: 'TEST',
        path: 'another.mdc',
        description: 'Another doc',
      });
      expect(entries[2]).toEqual({
        category: 'ARCH',
        path: 'arch.mdc',
        description: 'Architecture',
      });
    });

    it('should handle Markdown with no Context Map section', () => {
      const mdContent = `# Title

Some content without Context Map`;
      
      const entries = parseContextEntries(mdContent);
      
      expect(entries).toHaveLength(0);
    });

    it('should handle empty Markdown Context Map', () => {
      const mdContent = `## Context Map

## Next Section`;
      
      const entries = parseContextEntries(mdContent);
      
      expect(entries).toHaveLength(0);
    });
  });

  describe('Real context.mdc file', () => {
    it('should parse the actual YAML context.mdc', () => {
      // This is the actual content from public/context.mdc
      const actualContent = `version: "1.0"
contextMap:
  - category: INDEX
    entries:
      - path: docs/index.mdc
        description: Nexusドキュメント索引
  - category: PRD
    entries:
      - path: docs/PRD/index.mdc
        description: Features Registry（NEX-ID管理）
      - path: docs/PRD/要求仕様書.mdc
        description: 要求仕様（FR-01〜FR-08）
      - path: docs/PRD/システム要件定義書.mdc
        description: システム要件定義
      - path: docs/PRD/プロンプト辞書ドラフト.mdc
        description: プロンプト辞書
      - path: docs/PRD/戦略とビジョン.mdc
        description: プロダクト戦略
      - path: docs/PRD/ドキュメントテンプレート仕様.mdc
        description: ドキュメントテンプレート
  - category: ARCH
    entries:
      - path: docs/ARCH/index.mdc
        description: アーキテクチャ索引
      - path: docs/ARCH/システム概要.mdc
        description: システム概要
      - path: docs/ARCH/システム構成.mdc
        description: システム構成
      - path: docs/ARCH/セキュリティ設計.mdc
        description: セキュリティ設計
      - path: docs/ARCH/共通コンポーネント設計.mdc
        description: 共通コンポーネント方針
      - path: docs/ARCH/技術選定.mdc
        description: 技術選定（Electron + TypeScript）
      - path: docs/ARCH/IPC設計.mdc
        description: IPCインターフェース
  - category: DEVELOPMENT
    entries:
      - path: docs/DEVELOPMENT/index.mdc
        description: 開発ガイド
  - category: QA
    entries:
      - path: docs/QA/index.mdc
        description: QA方針・シナリオ
  - category: GATES
    entries:
      - path: docs/GATES/ドキュメント品質ゲート.mdc
        description: Quality Gates（DOC-01〜DOC-08）
      - path: docs/GATES/index.mdc
        description: Quality Gates索引`;

      const entries = parseContextEntries(actualContent);

      expect(entries).toHaveLength(19);
      
      // Check categories
      const categories = [...new Set(entries.map(e => e.category))];
      expect(categories).toEqual(['INDEX', 'PRD', 'ARCH', 'DEVELOPMENT', 'QA', 'GATES']);
      
      // Check first entry
      expect(entries[0]).toEqual({
        category: 'INDEX',
        path: 'docs/index.mdc',
        description: 'Nexusドキュメント索引',
      });
      
      // Check PRD has 7 entries
      const prdEntries = entries.filter(e => e.category === 'PRD');
      expect(prdEntries).toHaveLength(7);
    });
  });

  describe('Error handling', () => {
    it('should fallback to Markdown when YAML parsing fails', () => {
      const invalidYaml = `This is not valid YAML or Markdown with Context Map

Just random content`;
      
      const entries = parseContextEntries(invalidYaml);
      
      expect(entries).toHaveLength(0);
    });

    it('should handle empty string', () => {
      const entries = parseContextEntries('');
      
      expect(entries).toHaveLength(0);
    });
  });
});

