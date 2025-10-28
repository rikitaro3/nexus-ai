/**
 * 日付をロケールに合わせてフォーマットします。
 */
export function formatDate(
  input: Date | string | number,
  locale: string = 'ja-JP',
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' }
): string {
  const date = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(date.getTime())) {
    throw new Error('不正な日付が指定されました。');
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
}

/**
 * 一意なIDを生成します。prefixを指定すると、IDの先頭に付与します。
 */
export function generateId(prefix = ''): string {
  const separator = prefix ? '_' : '';

  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}${separator}${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);

  return `${prefix}${separator}${timestamp}${random}`;
}

/**
 * JSON文字列のパースを安全に行います。失敗時はundefinedを返します。
 */
export function safeParseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return undefined;
  }
}
