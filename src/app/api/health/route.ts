import { NextResponse } from 'next/server';

import { Result } from '@/lib/domain';
import { logger } from '@/lib/logger';

export function GET(): Response {
  logger.info('ヘルスチェックAPIが呼び出されました。');

  const result = Result.ok({ status: 'ok' });

  return NextResponse.json(result.unwrap());
}
