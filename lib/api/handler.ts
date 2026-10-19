import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { HttpError } from '@/lib/api/errors';

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route: maps HttpError/ZodError to JSON and hides internals on unexpected errors. */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: 'Invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
          { status: 400 }
        );
      }
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}`, err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

export async function parseJson<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
  return schema.parse(body);
}
