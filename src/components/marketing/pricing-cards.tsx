"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass, cx } from "@/components/ui";

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthly: number;
  annual: number;
  currency: string;
  rows: string[];
}

const money = (cents: number, cur: string) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: cur.toUpperCase(), maximumFractionDigits: 0 });

export function PricingCards({ plans, ctaHref = "/signup", currentPlan }: { plans: PricingPlan[]; ctaHref?: string; currentPlan?: string }) {
  const [annual, setAnnual] = useState(false);
  return (
    <div>
      <div className="mb-8 flex justify-center">
        <div className="inline-flex rounded-lg border border-line bg-ink-850 p-1" role="radiogroup" aria-label="Billing interval">
          {[false, true].map((a) => (
            <button
              key={String(a)}
              role="radio"
              aria-checked={annual === a}
              onClick={() => setAnnual(a)}
              className={cx("rounded-md px-4 py-1.5 text-sm", annual === a ? "bg-ink-700 text-fg" : "text-fg-muted")}
            >
              {a ? "Annual" : "Monthly"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const featured = p.id === "pro";
          const price = annual ? p.annual : p.monthly;
          const savings = p.monthly > 0 ? Math.round((1 - p.annual / (p.monthly * 12)) * 100) : 0;
          return (
            <div key={p.id} className={cx("card relative flex flex-col p-6", featured && "border-up/40 shadow-[0_0_60px_-30px_rgba(31,224,138,0.5)]")}>
              {featured && <span className="absolute -top-2.5 left-6 rounded-md bg-up px-2 py-0.5 text-[11px] font-semibold text-ink-950">Most popular</span>}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-fg-muted">{p.description}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="num text-3xl font-semibold">{money(price, p.currency)}</span>
                <span className="text-sm text-fg-faint">{p.monthly === 0 ? "forever" : annual ? "/ year" : "/ month"}</span>
              </div>
              <div className="h-5 text-xs text-up">{annual && savings > 0 ? `Save ${savings}% vs monthly` : ""}</div>
              <ul className="mt-4 flex-1 space-y-2">
                {p.rows.map((r) => (
                  <li key={r} className="flex gap-2 text-sm text-fg-muted">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-up" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {r}
                  </li>
                ))}
              </ul>
              {currentPlan === p.id ? (
                <span className={buttonClass("secondary", "lg", "mt-6 w-full")}>Current plan</span>
              ) : (
                <Link href={`${ctaHref}${ctaHref.includes("?") ? "&" : "?"}plan=${p.id}&interval=${annual ? "year" : "month"}`} className={buttonClass(featured ? "primary" : "secondary", "lg", "mt-6 w-full")}>
                  {p.monthly === 0 ? "Start free" : `Choose ${p.name}`}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
