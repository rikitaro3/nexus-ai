import { parseContextEntries } from '../context';

describe('parseContextEntries', () => {
  it('parses YAML context maps', () => {
    const yaml = `contextMap:\n  - category: Design\n    entries:\n      - path: docs/design.mdc\n        description: Design doc`; // eslint-disable-line max-len
    const entries = parseContextEntries(yaml);
    expect(entries).toEqual([
      {
        category: 'Design',
        path: 'docs/design.mdc',
        description: 'Design doc',
      },
    ]);
  });

  it('falls back to markdown parsing', () => {
    const markdown = `## Context Map\n### Backend\n- docs/api.mdc … API docs`;
    const entries = parseContextEntries(markdown);
    expect(entries).toEqual([
      {
        category: 'Backend',
        path: 'docs/api.mdc',
        description: 'API docs',
      },
    ]);
  });

  it('returns empty array for unsupported structures', () => {
    expect(parseContextEntries('## No Context')).toEqual([]);
  });
});
