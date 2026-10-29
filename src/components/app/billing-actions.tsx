"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, cx, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";

export interface PlanOption {
  id: string;
  name: string;
  monthly: number;
  annual: number;
  purchasable: { month: boolean; year: boolean };
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function BillingActions({ plans, currentPlan, hasStripeSub, cancelAtPeriodEnd, configured, cryptoAvailable = false }: { plans: PlanOption[]; currentPlan: string; hasStripeSub: boolean; cancelAtPeriodEnd: boolean; configured: boolean; cryptoAvailable?: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [interval, setInterval] = useState<"month" | "year">(sp.get("interval") === "year" ? "year" : "month");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const autoStarted = useRef(false);

  async function run(key: string, url: string, body: unknown) {
    setBusy(key);
    setMsg(null);
    const r = await apiFetch<{ url?: string; pending?: string }>(url, { body });
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "down", text: r.error ?? "Request failed" });
    if (r.data?.url) {
      window.location.href = r.data.url;
      return;
    }
    setMsg({ tone: "info", text: r.data?.pending ?? "Done." });
    setTimeout(() => router.refresh(), 2500);
  }

  // Coming from the pricing page with ?plan=pro → start checkout automatically once.
  useEffect(() => {
    const p = sp.get("plan");
    if (!autoStarted.current && configured && !hasStripeSub && (p === "pro" || p === "elite")) {
      autoStarted.current = true;
      void run(`buy-${p}`, "/api/billing/checkout", { planId: p, interval: sp.get("interval") === "year" ? "year" : "month" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!configured && cryptoAvailable) {
    return <p className="text-sm text-fg-muted">Card payments are not set up on this deployment. Pay with USDC or SOL below.</p>;
  }
  if (!configured) {
    return <Notice tone="warn" title="Billing is not configured">This deployment has no Stripe keys, so paid plans cannot be purchased. Administrators can grant plans manually (audited) from the admin panel.</Notice>;
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-line bg-ink-900 p-1" role="radiogroup" aria-label="Billing interval">
        {(["month", "year"] as const).map((i) => (
          <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={cx("rounded-md px-3 py-1 text-sm", interval === i ? "bg-ink-700 text-fg" : "text-fg-muted")}>
            {i === "month" ? "Monthly" : "Annual"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.filter((p) => p.id !== "free").map((p) => {
          const isCurrent = p.id === currentPlan;
          const available = p.purchasable[interval];
          const key = `${hasStripeSub ? "change" : "buy"}-${p.id}`;
          return (
            <div key={p.id} className={cx("rounded-lg border p-4", isCurrent ? "border-up/40 bg-up/5" : "border-line")}>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{p.name}</span>
                <span className="num text-sm">{money(interval === "year" ? p.annual : p.monthly)}<span className="text-fg-faint">/{interval === "year" ? "yr" : "mo"}</span></span>
              </div>
              <Button
                className="mt-3 w-full"
                variant={isCurrent ? "secondary" : "primary"}
                disabled={!available || busy !== null}
                onClick={() =>
                  hasStripeSub
                    ? run(key, "/api/billing/manage", { action: "change", planId: p.id, interval })
                    : run(key, "/api/billing/checkout", { planId: p.id, interval })
                }
              >
                {busy === key ? "Redirecting…" : !available ? "Not available" : hasStripeSub ? (isCurrent ? `Switch to ${interval === "year" ? "annual" : "monthly"}` : `Change to ${p.name}`) : `Subscribe to ${p.name}`}
              </Button>
            </div>
          );
        })}
      </div>
      {hasStripeSub && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => run("portal", "/api/billing/manage", { action: "portal" })}>{busy === "portal" ? "Opening…" : "Payment methods & invoices"}</Button>
          {cancelAtPeriodEnd ? (
            <Button disabled={busy !== null} variant="primary" onClick={() => run("resume", "/api/billing/manage", { action: "resume" })}>Resume subscription</Button>
          ) : (
            <Button disabled={busy !== null} variant="danger" onClick={() => run("cancel", "/api/billing/manage", { action: "cancel" })}>Cancel at period end</Button>
          )}
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
