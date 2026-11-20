// app/api/generate/route.ts — HTTP adapter for the drafts use case.
// All the logic lives in lib/application/drafts.ts so automations and future
// entry points (CLI, MCP) can reuse it without going through HTTP.
import { NextResponse } from 'next/server';
import { generateDrafts } from '@/lib/application/drafts';
import { route } from '@/lib/http/route';

export const maxDuration = 300;

const handler_POST = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const result = await generateDrafts(body);
  return NextResponse.json(result.body, { status: result.status });
}

export const POST = route(handler_POST);
