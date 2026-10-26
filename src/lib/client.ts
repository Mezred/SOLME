"use client";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  code?: string;
  details?: unknown;
}

/** JSON fetch for same-origin API routes; never throws, returns a uniform result. */
export async function apiFetch<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      let error = json?.error ?? `Request failed (${res.status})`;
      if (json?.code === "validation_error" && Array.isArray(json.details) && json.details[0]) {
        const d = json.details[0] as { path: string; message: string };
        error = d.path ? `${d.path}: ${d.message}` : d.message;
      }
      return { ok: false, status: res.status, data: null, error, code: json?.code, details: json?.details };
    }
    return { ok: true, status: res.status, data: json as T, error: null };
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error — check your connection and try again." };
  }
}
