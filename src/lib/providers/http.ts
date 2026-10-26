import { errorMessage, logger } from "@/lib/log";

const log = logger("providers");

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(`[${provider}] ${message}`);
  }
}

interface ProviderLimits {
  /** Requests allowed per minute (token bucket refill rate). */
  perMinute: number;
  /** Max burst size. */
  burst?: number;
}

class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private ratePerMs: number,
    private capacity: number,
  ) {
    this.tokens = capacity;
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.ratePerMs);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(Math.ceil((1 - this.tokens) / this.ratePerMs));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CacheEntry {
  value: unknown;
  expires: number;
}

type HealthSink = (provider: string, ok: boolean, latencyMs: number, error?: string) => void;
let healthSink: HealthSink = () => {};
export function setHealthSink(fn: HealthSink) {
  healthSink = fn;
}

export interface RequestOptions {
  /** Cache successful JSON responses for this many seconds (0 = no cache). */
  cacheSeconds?: number;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Treat this HTTP status as "no data" and return null instead of throwing. */
  nullOn?: number[];
}

/**
 * A rate-limited, cached, deduplicating JSON client for one upstream provider.
 * Shared process-wide so all users hit the same cache — we never fan out per user.
 */
export class ProviderClient {
  private bucket: TokenBucket;
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    public readonly name: string,
    private baseUrl: string,
    limits: ProviderLimits,
    private defaultHeaders: Record<string, string> = {},
  ) {
    this.bucket = new TokenBucket(limits.perMinute / 60_000, limits.burst ?? Math.max(1, Math.floor(limits.perMinute / 6)));
  }

  async get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...opts, method: "GET" });
  }

  async post<T>(path: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>(path, { ...opts, method: "POST", body });
  }

  private async request<T>(path: string, opts: RequestOptions): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const key = `${opts.method ?? "GET"} ${url} ${opts.body ? JSON.stringify(opts.body) : ""}`;

    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value as T;

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const p = this.fetchWithRetry<T>(url, opts)
      .then((value) => {
        if (opts.cacheSeconds && value !== null) {
          this.cache.set(key, { value, expires: Date.now() + opts.cacheSeconds * 1000 });
          if (this.cache.size > 2000) this.evict();
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private evict() {
    const now = Date.now();
    for (const [k, v] of this.cache) if (v.expires <= now) this.cache.delete(k);
    if (this.cache.size > 1500) {
      const drop = [...this.cache.keys()].slice(0, this.cache.size - 1500);
      drop.forEach((k) => this.cache.delete(k));
    }
  }

  private async fetchWithRetry<T>(url: string, opts: RequestOptions): Promise<T> {
    const retries = opts.retries ?? 3;
    let attempt = 0;
    for (;;) {
      await this.bucket.take();
      const started = Date.now();
      try {
        const res = await fetch(url, {
          method: opts.method ?? "GET",
          headers: {
            Accept: "application/json",
            ...(opts.body ? { "Content-Type": "application/json" } : {}),
            ...this.defaultHeaders,
            ...opts.headers,
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
          cache: "no-store",
        });
        if (opts.nullOn?.includes(res.status)) {
          healthSink(this.name, true, Date.now() - started);
          return null as T;
        }
        if (!res.ok) {
          const retryable = res.status === 429 || res.status >= 500;
          const retryAfter = Number(res.headers.get("retry-after"));
          const text = (await res.text().catch(() => "")).slice(0, 200);
          const err = new ProviderError(this.name, `HTTP ${res.status} ${text}`, res.status, retryable);
          if (retryable && attempt < retries) {
            attempt++;
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
            continue;
          }
          throw err;
        }
        const json = (await res.json()) as T;
        healthSink(this.name, true, Date.now() - started);
        return json;
      } catch (err) {
        const isProviderErr = err instanceof ProviderError;
        const retryable = isProviderErr ? err.retryable : true; // network errors / timeouts
        if (!isProviderErr && attempt < retries) {
          attempt++;
          await sleep(backoff(attempt));
          continue;
        }
        healthSink(this.name, false, Date.now() - started, errorMessage(err));
        log.warn("Provider request failed", { provider: this.name, url: redact(url), error: errorMessage(err), retryable });
        throw isProviderErr ? err : new ProviderError(this.name, errorMessage(err), undefined, true);
      }
    }
  }
}

/** Exponential backoff with full jitter: ~0.5s, 1s, 2s, 4s… capped at 15s. */
export function backoff(attempt: number): number {
  const base = Math.min(15_000, 500 * 2 ** (attempt - 1));
  return Math.round(base / 2 + Math.random() * (base / 2));
}

/** Strip API keys from URLs before logging. */
export function redact(url: string): string {
  return url.replace(/(api[-_]?key|key|token)=[^&]+/gi, "$1=***");
}
