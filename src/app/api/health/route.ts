import { NextResponse } from 'next/server';

import { HttpError, Result } from '@/lib/domain';
import { logger } from '@/lib/logger';

export function GET() {
  logger.info('ヘルスチェックAPIが呼び出されました。');

  const result = Result.ok({ status: 'ok' });

  return result.match({
    ok: (value) => NextResponse.json(value),
    err: (error) => {
      const httpError = HttpError.fromUnknown(error, 500, 'ヘルスチェックに失敗しました。');
      return NextResponse.json(httpError.toJSON(), { status: httpError.status });
    },
  });
}
