import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { errorMessage, logger } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";

const log = logger("api");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, "bad_request", details);
export const notFound = (msg = "Not found") => new ApiError(404, msg, "not_found");
export const forbidden = (msg = "Forbidden") => new ApiError(403, msg, "forbidden");
export const upgradeRequired = (msg: string) => new ApiError(402, msg, "upgrade_required");

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Wraps a Route Handler: same-origin check for mutations, uniform JSON errors, and logging.
 * Unknown errors are never leaked to clients.
 */
export function api<C = unknown>(handler: Handler<C>, opts: { skipOriginCheck?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      if (!opts.skipOriginCheck && !["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Invalid input", code: "validation_error", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      log.error("Unhandled API error", { path: new URL(req.url).pathname, method: req.method, error: errorMessage(err) });
      return NextResponse.json({ error: "Internal server error", code: "internal" }, { status: 500 });
    }
  };
}

/** CSRF defense for cookie-authenticated mutations (in addition to SameSite=Lax cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw forbidden("Missing origin");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Bad origin");
  }
  if (originHost !== host) throw forbidden("Cross-origin request blocked");
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Sign in required", "unauthorized");
  return user;
}

export async function requireRole(...roles: SessionUser["role"][]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw forbidden("Insufficient permissions");
  return user;
}

export const requireAdmin = () => requireRole("admin");

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.allowed) {
    // Human-readable wait time for the UI; the exact reset time stays available in the error details.
    const minutes = Math.max(1, Math.ceil((r.resetAt.getTime() - Date.now()) / 60_000));
    const wait = minutes < 60 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.ceil(minutes / 60)} hour${minutes > 60 ? "s" : ""}`;
    throw new ApiError(429, `Too many attempts. Please try again in ${wait}.`, "rate_limited", {
      resetAt: r.resetAt,
    });
  }
  return r;
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
