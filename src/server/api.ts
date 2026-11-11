import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError, type ZodType } from "zod";
import { requireCtx, type Ctx } from "./auth";
import { AppError } from "./errors";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT = { windowMs: 60_000, max: 240 };
const buckets = new Map<string, { start: number; count: number }>();

function rateLimit(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start > RATE_LIMIT.windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT.max) throw new AppError("rate_limited", "Too many requests. Try again in a minute.");
}

/** Reject cross-site state-changing requests: the Origin header, when sent, must match the host. */
function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw new AppError("forbidden", "Cross-site request rejected.");
}

export function errorResponse(error: unknown, correlationId: string): NextResponse {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".") || "_";
      (fieldErrors[path] ??= []).push(issue.message);
    }
    return NextResponse.json({ error: { code: "validation_error", message: "Some fields are invalid.", fieldErrors, correlationId } }, { status: 422 });
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors, details: error.details, correlationId } },
      { status: error.status },
    );
  }
  console.error(`[${correlationId}]`, error);
  return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong on the server.", correlationId } }, { status: 500 });
}

interface HandlerArgs<P> {
  req: NextRequest;
  ctx: Ctx;
  params: P;
  /** Parse and validate the JSON body. */
  body: <T>(schema: ZodType<T>) => Promise<T>;
  query: URLSearchParams;
}

type RouteContext<P> = { params: Promise<P> };

/** Wrap a route handler with authentication, CSRF/size/rate checks and the consistent error shape. */
export function route<P = Record<string, string>>(handler: (args: HandlerArgs<P>) => Promise<unknown>) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<Response> => {
    let correlationId: string = randomUUID();
    try {
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (mutating) {
        assertSameOrigin(req);
        const length = Number(req.headers.get("content-length") ?? "0");
        if (length > MAX_BODY_BYTES) throw new AppError("payload_too_large", "Request body is larger than 2 MB.");
      }
      const ctx = await requireCtx();
      correlationId = ctx.correlationId;
      if (mutating) rateLimit(ctx.userId);
      const params = await context.params;
      const result = await handler({
        req,
        ctx,
        params,
        query: req.nextUrl.searchParams,
        body: async (schema) => {
          let json: unknown;
          try {
            json = await req.json();
          } catch {
            throw new AppError("validation_error", "Request body must be valid JSON.");
          }
          return schema.parse(json);
        },
      });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (error) {
      return errorResponse(error, correlationId);
    }
  };
}
