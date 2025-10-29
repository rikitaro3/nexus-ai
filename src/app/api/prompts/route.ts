import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';

export async function GET() {
  try {
    const promptsPath = path.join(process.cwd(), 'prompts.json');
    const content = await fs.readFile(promptsPath, 'utf-8');
    const data = JSON.parse(content);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API] Failed to load prompts.json', error);
    return NextResponse.json(
      { error: 'Failed to load prompts dictionary' },
      { status: 500 }
    );
  }
}

