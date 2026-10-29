"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS: [string, string, boolean][] = [
  ["/admin", "Overview", false],
  ["/admin/users", "Users", false],
  ["/admin/subscriptions", "Subscriptions & payments", false],
  ["/admin/providers", "API providers", false],
  ["/admin/alerts", "Alert delivery", false],
  ["/admin/logs", "Errors & jobs", false],
  ["/admin/security", "Security & audit log", false],
  ["/admin/plans", "Pricing & entitlements", false],
  ["/admin/scoring", "Scoring weights", false],
  ["/admin/ingestion", "Data refresh", false],
  ["/admin/wallets", "Documented wallets", false],
  ["/admin/support", "Support tickets", true],
];

export function AdminNav({ role }: { role: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-line bg-ink-900 py-3 md:block">
      {ITEMS.filter(([, , supportOk]) => role === "admin" || supportOk).map(([href, label]) => {
        const active = href === "/admin" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cx("mx-2 block rounded-md px-3 py-1.5 text-[13px]", active ? "bg-ink-700 text-fg" : "text-fg-muted hover:bg-ink-750 hover:text-fg")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
