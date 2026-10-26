"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand";
import { buttonClass, cx } from "@/components/ui";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/methodology", label: "Methodology" },
  { href: "/faq", label: "FAQ" },
];

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-ink-950/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6" aria-label="Main">
        <Logo />
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={cx("rounded-md px-3 py-1.5 text-sm transition-colors", path === l.href ? "text-fg" : "text-fg-muted hover:text-fg")}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link href="/app" className={buttonClass("primary", "md")}>
              Open terminal
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "md")}>
                Log in
              </Link>
              <Link href="/signup" className={buttonClass("primary", "md")}>
                Start free
              </Link>
            </>
          )}
        </div>
        <button className="rounded-md p-2 text-fg-muted md:hidden" aria-label="Toggle menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            {open ? <path d="M5 5l10 10M15 5 5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
        </button>
      </nav>
      {open && (
        <div className="border-t border-line px-4 pb-4 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2.5 text-sm text-fg-muted">
              {l.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-2">
            {signedIn ? (
              <Link href="/app" className={buttonClass("primary", "md", "flex-1")}>
                Open terminal
              </Link>
            ) : (
              <>
                <Link href="/login" className={buttonClass("secondary", "md", "flex-1")}>
                  Log in
                </Link>
                <Link href="/signup" className={buttonClass("primary", "md", "flex-1")}>
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
