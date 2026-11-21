// lib/http/route.ts — the HTTP adapter helper.
//
// Every API route asks for a session through `route()`, so the sign-in check
// lives in one place instead of only in the proxy. The proxy stays optimistic
// for API calls (it only redirects page visits); a route called from anywhere
// else — a background job, a future CLI — is still protected.
//
//   export const GET = route(async (req) => NextResponse.json({ ok: true }));
//
import { NextResponse } from 'next/server';
import { requestUser } from '../auth';

/** Throw from a handler to answer with a specific status and message. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type RouteHandler = (req: Request, user: string, ...rest: any[]) => any;

/**
 * Wrap a route handler with the session check and a JSON error boundary.
 * Extra arguments (e.g. Next's `{ params }` context) are passed through.
 */
export function route(handler: RouteHandler) {
  return async (req: Request, ...rest: any[]): Promise<Response> => {
    const user = requestUser(req);
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    try {
      const out = await handler(req, user, ...rest);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? {});
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      // any error that declares a status is honoured (a rejected setting is a
      // 400, not a server error) — without the wrapper importing the layer
      const declared = Number(e?.status);
      if (Number.isInteger(declared) && declared >= 400 && declared < 600) {
        return NextResponse.json({ error: String(e?.message || e) || 'Bad request' }, { status: declared });
      }
      return NextResponse.json({ error: String(e?.message || e) || 'Server error' }, { status: 500 });
    }
  };
}
