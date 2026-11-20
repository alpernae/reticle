import { NextResponse, connection } from 'next/server';
import { FORMAT_PLAYBOOK, FORMATS_BY_PLATFORM, PLATFORM_PLAYBOOK, ROLE_PLAYBOOK } from '@/lib/playbook';
import { readPlaybookOverrides, savePlaybookOverride, systemPrompt } from '@/lib/prompt';
import { route } from '@/lib/http/route';

/** GET → defaults + your overrides.  GET ?preview=1&platform=&format=&role= → the full composed system prompt. */
const handler_GET = async (req: Request) => {
  await connection(); // request-time — overrides live in SQLite
  const q = new URL(req.url).searchParams;
  if (q.get('preview')) {
    const text = systemPrompt({ platform: q.get('platform'), format: q.get('format'), role: q.get('role') });
    return NextResponse.json({ text, chars: text.length });
  }
  return NextResponse.json({
    defaults: { platforms: PLATFORM_PLAYBOOK, formats: FORMAT_PLAYBOOK, roles: ROLE_PLAYBOOK },
    formatsByPlatform: FORMATS_BY_PLATFORM,
    overrides: readPlaybookOverrides(),
  });
}

/** POST { kind: 'platforms'|'formats'|'roles'|'voice', key, text } — text null/'' resets to the default. */
const handler_POST = async (req: Request) => {
  const b = await req.json().catch(() => ({} as any));
  const kind = String(b?.kind || '');
  if (!['platforms', 'formats', 'roles', 'voice'].includes(kind)) return NextResponse.json({ error: 'bad kind' }, { status: 400 });
  const key = String(b?.key || '');
  const known = kind === 'formats' ? FORMAT_PLAYBOOK : kind === 'roles' ? ROLE_PLAYBOOK : PLATFORM_PLAYBOOK;
  if (!(key in known)) return NextResponse.json({ error: 'unknown key' }, { status: 400 });
  const overrides = savePlaybookOverride(kind as 'platforms' | 'formats' | 'roles' | 'voice', key, typeof b?.text === 'string' ? b.text : null);
  return NextResponse.json({ overrides });
}

export const GET = route(handler_GET);
export const POST = route(handler_POST);
