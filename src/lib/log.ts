/**
 * Structured JSON logging to stdout. warn/error entries are also persisted to app_logs
 * (best-effort, never throws) so administrators can review them in the admin panel.
 */
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, source: string, message: string, context: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, source, message, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level !== "debug" || process.env.LOG_DEBUG) console.log(line);

  if (level === "warn" || level === "error") {
    import("@/lib/db")
      .then(({ query }) =>
        query("INSERT INTO app_logs (level, source, message, context) VALUES ($1, $2, $3, $4)", [
          level,
          source,
          message.slice(0, 2000),
          JSON.stringify(context),
        ]),
      )
      .catch(() => {});
  }
}

export function logger(source: string) {
  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => emit("debug", source, msg, ctx),
    info: (msg: string, ctx?: Record<string, unknown>) => emit("info", source, msg, ctx),
    warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", source, msg, ctx),
    error: (msg: string, ctx?: Record<string, unknown>) => emit("error", source, msg, ctx),
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
