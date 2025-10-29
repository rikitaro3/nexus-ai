import { mkdir, readFile, writeFile } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { dirname, join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // URLからpathパラメータを取得
    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get('path');
    
    if (!filePath) {
      return NextResponse.json({ error: 'Path parameter is required' }, { status: 400 });
    }
    
    // セキュリティ: パストラバーサル攻撃を防ぐ
    if (filePath.includes('..') || filePath.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    
    console.log('[API /api/docs] Fetching file:', filePath);
    
    // docsフォルダからファイルを読み込む
    // filePathがdocs/で始まる場合はそのまま使用、そうでなければdocs/を追加
    const fullPath = filePath.startsWith('docs/') 
      ? join(process.cwd(), filePath)
      : join(process.cwd(), 'docs', filePath);
    console.log('[API /api/docs] Full path:', fullPath);
    
    const content = await readFile(fullPath, 'utf-8');
    
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('[API /api/docs] Error reading file:', error);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, content } = body;
    
    // 入力検証
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 });
    }
    
    if (content === undefined || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }
    
    // セキュリティチェック
    if (path.includes('..') || path.startsWith('/')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    
    // docsフォルダ内のみ書き込み可能
    if (!path.startsWith('docs/')) {
      return NextResponse.json({ error: 'Can only write to docs/ folder' }, { status: 403 });
    }
    
    console.log('[API POST /api/docs] Saving file:', path);
    
    // ファイルパス構築
    const fullPath = join(process.cwd(), path);
    console.log('[API POST /api/docs] Full path:', fullPath);
    
    // ディレクトリの存在確認（なければ作成）
    const dir = dirname(fullPath);
    await mkdir(dir, { recursive: true });
    
    // ファイル書き込み
    await writeFile(fullPath, content, 'utf-8');
    
    console.log('[API POST /api/docs] Successfully saved:', path);
    
    return NextResponse.json({ 
      success: true,
      message: 'Document saved successfully',
    });
    
  } catch (error) {
    console.error('[API POST /api/docs] Error saving file:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

