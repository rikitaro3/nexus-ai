import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';

export function GET() {
  logger.info('ヘルスチェックAPIが呼び出されました。');

  return NextResponse.json({ status: 'ok' });
}
