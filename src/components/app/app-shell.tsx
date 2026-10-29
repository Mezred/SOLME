"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo, LogoMark } from "@/components/brand";
import { Badge, ChainBadge, cx, TokenAvatar } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { NAV, NavIcon } from "./nav-items";

interface ShellUser {
  email: string;
  displayName: string | null;
  role: string;
  emailVerified: boolean;
  plan: string;
}

export function AppShell({ user, unread, demoMode, children }: { user: ShellUser; unread: number; demoMode: boolean; children: ReactNode }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));
  const main = NAV.filter((n) => n.group === "main");
  const account = NAV.filter((n) => n.group === "account");
  const badge = (href: string) => (href === "/app/alerts" && unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null);

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop: a fixed left sidebar with the four features and Alerts, then the account pages. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-ink-950 lg:flex">
        <div className="flex h-14 items-center px-5"><Logo href="/app" /></div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
          <ul className="space-y-0.5">
            {main.map((n) => <SideLink key={n.href} n={n} active={isActive(n.href)} badge={badge(n.href)} />)}
          </ul>
          <div className="mb-1 mt-6 px-3 text-[10px] font-semibold uppercase tracking-widest text-fg-faint">Account</div>
          <ul className="space-y-0.5">
            {account.map((n) => <SideLink key={n.href} n={n} active={isActive(n.href)} badge={null} />)}
            {user.role === "admin" && (
              <li>
                <Link href="/admin" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-warn hover:bg-ink-800">
                  <NavIcon d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
                  Admin
                </Link>
              </li>
            )}
          </ul>
        </nav>
        <div className="border-t border-line px-5 py-3 text-xs text-fg-faint">
          Plan <Badge tone={user.plan === "Free" ? "neutral" : "ai"}>{user.plan}</Badge>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {demoMode && (
          <div className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn" role="status">
            DEMO MODE: all market data, scores and security results shown are synthetic and for demonstration only.
          </div>
        )}
        {!user.emailVerified && <VerifyBanner />}
        <header className="sticky top-0 z-30 border-b border-line bg-ink-950/95 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-3 sm:px-5 lg:px-8">
            <Link href="/app" aria-label="Early Coins" className="shrink-0 lg:hidden"><LogoMark /></Link>
            <div className="w-full max-w-md"><TokenSearch /></div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href="/app/alerts?tab=inbox" className="relative rounded-md p-2 text-fg-muted hover:bg-ink-750 hover:text-fg" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
                <NavIcon d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4" />
                {unread > 0 && <span className="num absolute right-1 top-1 min-w-4 rounded-full bg-down px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <UserMenu user={user} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 pb-24 pt-5 sm:px-5 lg:px-8 lg:pb-8">{children}</main>
      </div>

      {/* Phone: the four features and Alerts as a bottom tab bar. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-950/95 backdrop-blur lg:hidden">
        <ul className="grid grid-cols-4">
          {main.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={isActive(n.href) ? "page" : undefined}
                className={cx("relative flex flex-col items-center gap-1 py-2 text-[10px]", isActive(n.href) ? "text-up" : "text-fg-muted")}
              >
                <NavIcon d={n.icon} className="h-5 w-5" />
                {n.short}
                {badge(n.href) && <span className="num absolute right-[22%] top-1 min-w-4 rounded-full bg-down px-1 text-center text-[9px] font-semibold leading-4 text-white">{badge(n.href)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function SideLink({ n, active, badge }: { n: { href: string; label: string; icon: string }; active: boolean; badge: string | null }) {
  return (
    <li>
      <Link
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-up/10 text-up" : "text-fg-muted hover:bg-ink-800 hover:text-fg")}
      >
        <NavIcon d={n.icon} />
        <span className="flex-1">{n.label}</span>
        {badge && <span className="num rounded-full bg-down px-1.5 text-[10px] font-semibold leading-4 text-white">{badge}</span>}
      </Link>
    </li>
  );
}

function VerifyBanner() {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line-strong bg-ink-900 px-4 py-1.5 text-xs text-up-soft">
      <span>Verify your email to enable email alerts and billing.</span>
      {state === "sent" ? (
        devUrl ? <a href={devUrl} className="underline">Dev: open verification link</a> : <span>Sent — check your inbox.</span>
      ) : (
        <button
          className="underline"
          onClick={async () => {
            const r = await apiFetch<{ devVerifyUrl?: string }>("/api/auth/resend-verification", { method: "POST" });
            setState(r.ok ? "sent" : "error");
            setDevUrl(r.data?.devVerifyUrl ?? null);
          }}
        >
          {state === "error" ? "Try again" : "Resend verification email"}
        </button>
      )}
    </div>
  );
}

interface SearchHit {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  address: string;
  logo_url: string | null;
}

function TokenSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setHits] = useState<SearchHit[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchable = q.trim().length >= 2;
  const hits = searchable ? results : [];
  const open = isOpen && searchable;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!searchable) return;
    timer.current = setTimeout(async () => {
      const r = await apiFetch<{ results: SearchHit[] }>(`/api/tokens/search?q=${encodeURIComponent(q.trim())}`);
      setHits(r.data?.results ?? []);
      setActive(0);
      setOpen(true);
    }, 220);
  }, [q, searchable]);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ("");
    router.push(`/app/token/${h.chain}/${h.id}`);
  };

  return (
    <div className="relative w-full max-w-md">
      <label htmlFor="token-search" className="sr-only">
        Search tokens
      </label>
      <input
        id="token-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && hits[active]) go(hits[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search symbol, name or contract address…"
        className="input h-9 pl-8"
        role="combobox"
        aria-expanded={open}
        aria-controls="token-search-results"
        autoComplete="off"
      />
      <NavIcon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-fg-faint" />
      {open && (
        <ul id="token-search-results" role="listbox" className="card absolute left-0 right-0 top-11 z-50 max-h-80 overflow-auto p-1 shadow-2xl">
          {hits.length === 0 ? (
            <li className="px-3 py-3 text-sm text-fg-faint">No tracked tokens match. Paste a contract address to look it up.</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === active}>
                <button onMouseDown={() => go(h)} className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === active ? "bg-ink-700" : "hover:bg-ink-750")}>
                  <TokenAvatar symbol={h.symbol} logo={h.logo_url} size={22} />
                  <span className="font-medium">{h.symbol}</span>
                  <span className="truncate text-fg-faint">{h.name}</span>
                  <span className="ml-auto">
                    <ChainBadge chain={h.chain} />
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initial = (user.displayName ?? user.email)[0]?.toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold text-fg ring-1 ring-line-strong" aria-label="Account menu" aria-expanded={open}>
        {initial}
      </button>
      {open && (
        <div className="card absolute right-0 top-10 z-50 w-56 p-1 shadow-2xl" role="menu">
          <div className="border-b border-line px-3 py-2">
            <div className="truncate text-sm font-medium">{user.displayName ?? user.email}</div>
            <div className="truncate text-xs text-fg-faint">{user.email}</div>
          </div>
          {NAV.filter((n) => n.group === "account").map((n) => (
            <Link key={n.href} href={n.href} role="menuitem" className="block rounded px-3 py-1.5 text-sm text-fg-muted hover:bg-ink-750 hover:text-fg">
              {n.label}
            </Link>
          ))}
          {user.role === "admin" && (
            <Link href="/admin" role="menuitem" className="block rounded px-3 py-1.5 text-sm text-warn hover:bg-ink-750">Admin</Link>
          )}
          <button
            role="menuitem"
            onMouseDown={async () => {
              await apiFetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
              router.refresh();
            }}
            className="block w-full rounded px-3 py-1.5 text-left text-sm text-down hover:bg-ink-750"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
