export interface FeatureRecord {
  id: string;
  name: string;
  reqId: string;
  frRange: string;
  frCount: number | null;
  priority: string;
  status: string;
}

const TABLE_HEADER_MARKER = 'FEAT-ID';

function parseTableLine(line: string): string[] {
  return line
    .split('|')
    .map(cell => cell.trim())
    .filter(cell => cell.length > 0);
}

function isDividerLine(line: string): boolean {
  return /-\s*-/.test(line.replace(/\|/g, ''));
}

export function parseFeatRegistry(markdown: string): FeatureRecord[] {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => line.includes(TABLE_HEADER_MARKER));

  if (headerIndex === -1) {
    return [];
  }

  const records: FeatureRecord[] = [];

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line === '' || line.startsWith('**')) {
      break;
    }

    if (isDividerLine(line)) {
      continue;
    }

    if (!line.startsWith('|') && !line.startsWith('||')) {
      break;
    }

    const cells = parseTableLine(line);

    if (cells.length < 7) {
      continue;
    }

    const [id, name, reqId, frRange, frCountRaw, priority, status] = cells;

    const frCount = Number.parseInt(frCountRaw, 10);

    records.push({
      id,
      name,
      reqId,
      frRange,
      frCount: Number.isNaN(frCount) ? null : frCount,
      priority,
      status,
    });
  }

  return records;
}

export function searchByFeatId(features: FeatureRecord[], query: string): FeatureRecord[] {
  const trimmed = query.trim().toLowerCase();

  if (!trimmed) {
    return features;
  }

  return features.filter(feature => {
    return (
      feature.id.toLowerCase().includes(trimmed) ||
      feature.name.toLowerCase().includes(trimmed) ||
      feature.reqId.toLowerCase().includes(trimmed)
    );
  });
}
