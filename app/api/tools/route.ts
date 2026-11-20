// app/api/tools/route.ts — HTTP adapter for the Toolkit use case.
// The use case itself lives in lib/application/tools.ts.
import { NextResponse } from 'next/server';
import { runTool } from '@/lib/application/tools';

export const maxDuration = 240;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const result = await runTool(body);
  return NextResponse.json(result.body, { status: result.status });
}
