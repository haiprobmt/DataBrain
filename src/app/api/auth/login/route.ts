import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { loginSchema } from "@/lib/schemas";
import { errorResponse } from "@/server/api";
import { login, SESSION_COOKIE } from "@/server/auth";

const attempts = new Map<string, { start: number; count: number }>();

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const input = loginSchema.parse(await req.json());
    // Slow down password guessing: 10 attempts per email per 10 minutes.
    const now = Date.now();
    const bucket = attempts.get(input.email);
    if (bucket && now - bucket.start < 600_000 && bucket.count >= 10) {
      return NextResponse.json({ error: { code: "rate_limited", message: "Too many sign-in attempts. Try again in a few minutes.", correlationId } }, { status: 429 });
    }
    attempts.set(input.email, bucket && now - bucket.start < 600_000 ? { start: bucket.start, count: bucket.count + 1 } : { start: now, count: 1 });
    const { token, expiresAt } = await login(input.email, input.password);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(expiresAt) });
    return response;
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
