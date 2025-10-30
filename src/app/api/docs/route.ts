import { mkdir, readFile, writeFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { dirname } from 'path';

import { PathGuardError, resolveDocPath } from '@/server/docs/pathGuard';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get('path');

    if (!filePath) {
      throw new PathGuardError('Path parameter is required', 400, 'PATH_REQUIRED');
    }

    const { absolute } = resolveDocPath(filePath);
    console.log('[API /api/docs] Fetching file:', filePath, '->', absolute);

    const content = await readFile(absolute, 'utf-8');

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    if (error instanceof PathGuardError) {
      console.error('[API /api/docs] Path guard error:', error.message);
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    console.error('[API /api/docs] Error reading file:', error);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, content } = body as { path?: unknown; content?: unknown };

    if (typeof path !== 'string') {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 });
    }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const { absolute, relative } = resolveDocPath(path);
    console.log('[API POST /api/docs] Saving file:', path, '->', absolute);

    const dir = dirname(absolute);
    await mkdir(dir, { recursive: true });

    await writeFile(absolute, content, 'utf-8');

    console.log('[API POST /api/docs] Successfully saved:', relative);

    return NextResponse.json({
      success: true,
      message: 'Document saved successfully',
    });
  } catch (error) {
    if (error instanceof PathGuardError) {
      console.error('[API POST /api/docs] Path guard error:', error.message);
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    console.error('[API POST /api/docs] Error saving file:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
