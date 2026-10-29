"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, cx, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";

export interface PlanOption {
  id: string;
  name: string;
  monthly: number;
  annual: number;
}

export interface CryptoQuote {
  id: string;
  status: "pending" | "confirmed" | "expired";
  plan: string;
  interval: "month" | "year";
  currency: "USDC" | "SOL";
  amount: string;
  usd: number;
  recipient: string;
  url: string;
  qr: string;
  expiresAt: string;
  signature: string | null;
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * Pay for a plan with USDC or SOL on Solana (Solana Pay). Shows the quote's QR code and exact amount, then polls until
 * the payment is found on-chain. `extending`: the user already has a crypto plan, so paying adds a period to it.
 */
export function CryptoCheckout({ plans, currentPlan, extending, resume, suggested = null, initialPeriod = "month" }: {
  plans: PlanOption[];
  currentPlan: string;
  extending: boolean;
  resume: CryptoQuote | null;
  /** The plan picked on the pricing page, highlighted until the user chooses. */
  suggested?: string | null;
  initialPeriod?: "month" | "year";
}) {
  const [period, setPeriod] = useState<"month" | "year">(initialPeriod);
  const [currency, setCurrency] = useState<"USDC" | "SOL">("USDC");
  const [quote, setQuote] = useState<CryptoQuote | null>(resume);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(planId: string) {
    setBusy(planId);
    setError(null);
    const r = await apiFetch<CryptoQuote>("/api/billing/crypto", { body: { planId, interval: period, currency } });
    setBusy(null);
    if (!r.ok || !r.data) return setError(r.error ?? "Could not start the checkout");
    setQuote(r.data);
  }

  if (quote) return <QuoteView quote={quote} onUpdate={setQuote} onClose={() => setQuote(null)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Toggle value={period} onChange={setPeriod} options={[["month", "1 month"], ["year", "1 year"]]} label="Period" />
        <Toggle value={currency} onChange={setCurrency} options={[["USDC", "USDC"], ["SOL", "SOL"]]} label="Pay in" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.filter((p) => p.id !== "free").map((p) => {
          const cents = period === "year" ? p.annual : p.monthly;
          const renew = extending && p.id === currentPlan;
          return (
            <div key={p.id} className={cx("rounded-lg border p-4", p.id === currentPlan || p.id === suggested ? "border-up/40 bg-up/5" : "border-line")}>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{p.name}</span>
                <span className="num text-sm">{money(cents)}<span className="text-fg-faint"> {currency === "SOL" ? "in SOL" : "USDC"}</span></span>
              </div>
              <Button className="mt-3 w-full" variant="primary" disabled={cents <= 0 || busy !== null} onClick={() => start(p.id)}>
                {busy === p.id ? "Creating quote…" : renew ? `Extend ${p.name} by ${period === "year" ? "1 year" : "1 month"}` : `Pay for ${p.name}`}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-fg-faint">
        Paid straight to SOLME&apos;s Solana wallet, prepaid with no automatic renewal (you get a reminder 3 days before it ends).
        Renewing early adds the time on top; upgrading turns your remaining days into days on the new plan. SOL is priced at
        the current rate when you create the quote.
      </p>
      {error && <Notice tone="down">{error}</Notice>}
    </div>
  );
}

function Toggle<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-ink-900 p-1" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cx("rounded-md px-3 py-1 text-sm", value === v ? "bg-ink-700 text-fg" : "text-fg-muted")}>
          {l}
        </button>
      ))}
    </div>
  );
}

function QuoteView({ quote, onUpdate, onClose }: { quote: CryptoQuote; onUpdate: (q: CryptoQuote) => void; onClose: () => void }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [sig, setSig] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each poll also looks for the payment on-chain. Expired quotes are still credited for a day, so keep checking slowly.
  useEffect(() => {
    if (quote.status === "confirmed") return;
    const t = setTimeout(async () => {
      const r = await apiFetch<CryptoQuote>(`/api/billing/crypto/${quote.id}`);
      if (r.ok && r.data) {
        onUpdate(r.data);
        if (r.data.status === "confirmed") router.refresh();
      }
    }, quote.status === "pending" ? 4_000 : 15_000);
    return () => clearTimeout(t);
  }, [quote, onUpdate, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  async function claim() {
    setClaiming(true);
    setError(null);
    const r = await apiFetch<CryptoQuote>(`/api/billing/crypto/${quote.id}`, { body: { signature: sig } });
    setClaiming(false);
    if (!r.ok || !r.data) return setError(r.error ?? "Could not verify that transaction");
    onUpdate(r.data);
    if (r.data.status === "confirmed") router.refresh();
  }

  if (quote.status === "confirmed") {
    return (
      <div className="space-y-3">
        <Notice tone="info" title="Payment confirmed">
          {quote.amount} {quote.currency} received. SOLME {quote.plan} is active; your plan details above are updated.
        </Notice>
        {quote.signature && <a className="text-xs text-fg-muted underline" href={`https://solscan.io/tx/${quote.signature}`} target="_blank" rel="noreferrer">View the transaction on Solscan</a>}
        <div><Button size="sm" onClick={onClose}>Done</Button></div>
      </div>
    );
  }

  const left = Math.max(0, Math.floor((new Date(quote.expiresAt).getTime() - now) / 1000));
  const expired = quote.status === "expired" || left === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* QR codes need dark-on-light to scan reliably, in either theme. The SVG is generated server-side from the quote. */}
        <div className={cx("w-52 shrink-0 rounded-xl bg-white p-2", expired && "opacity-30")} aria-label="Solana Pay QR code" dangerouslySetInnerHTML={{ __html: quote.qr }} />
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <div>
            <div className="text-xs text-fg-faint">SOLME {quote.plan} · {quote.interval === "year" ? "1 year" : "1 month"} · ${quote.usd.toLocaleString("en-US")}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="num text-xl font-semibold">{quote.amount} {quote.currency}</span>
              <Copy value={quote.amount} />
            </div>
            <p className="mt-0.5 text-xs text-fg-faint">Send exactly this amount: the last digits identify your payment.</p>
          </div>
          <div>
            <div className="text-xs text-fg-faint">To (Solana{quote.currency === "USDC" ? ", USDC" : ""})</div>
            <div className="flex items-center gap-2">
              <span className="num break-all text-xs">{quote.recipient}</span>
              <Copy value={quote.recipient} />
            </div>
          </div>
          {!expired ? (
            <>
              <a href={quote.url} className="inline-flex rounded-lg bg-up px-4 py-2 text-sm font-semibold text-ink-950 hover:opacity-90">Open in wallet</a>
              <p className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-up" aria-hidden="true" />
                Waiting for the payment… quote valid for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
              </p>
            </>
          ) : (
            <Notice tone="warn" title="Quote expired">
              If you already paid, it is still credited automatically within a few minutes (for up to a day). Otherwise start a new quote.
            </Notice>
          )}
        </div>
      </div>

      <p className="text-xs text-fg-faint">
        Scan with Phantom, Solflare or Backpack, or tap &quot;Open in wallet&quot; on your phone. Pay from your own wallet, not an
        exchange: exchanges can&apos;t include the payment reference and often send a different amount.
      </p>

      <details className="rounded-lg border border-line p-3 text-sm">
        <summary className="cursor-pointer text-fg-muted">Sent it without the QR code? Paste the transaction signature</summary>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="input num flex-1" placeholder="Transaction signature" value={sig} onChange={(e) => setSig(e.target.value.trim())} aria-label="Transaction signature" />
          <Button disabled={sig.length < 64 || claiming} onClick={claim}>{claiming ? "Checking…" : "Verify payment"}</Button>
        </div>
        <p className="mt-1 text-xs text-fg-faint">It must send exactly {quote.amount} {quote.currency} to the address above, after this quote was created.</p>
      </details>

      {error && <Notice tone="down">{error}</Notice>}
      <Button size="sm" variant="ghost" onClick={onClose}>{expired ? "New quote" : "Cancel"}</Button>
    </div>
  );
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded border border-line px-1.5 py-0.5 text-[11px] text-fg-muted hover:text-fg"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
