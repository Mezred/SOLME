export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
}

/**
 * Top-bar navigation: an overview, then the everyday tools (screen, check a coin, proven-dev launches, smart wallets) and
 * their alerts. The account menu holds Watchlist, Billing and Settings. Icons are SVG path data (24×24, stroke).
 */
export const NAV: NavItem[] = [
  { group: "", href: "/app", label: "Overview", icon: "M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z" },
  { group: "", href: "/app/screener", label: "Screener", icon: "M3 5h18l-7 8v6l-4 2v-8L3 5Z" },
  { group: "", href: "/app/check", label: "Check a coin", icon: "M9 12l2 2 4-4M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3Z" },
  { group: "", href: "/app/smart-dev", label: "Proven Devs", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { group: "", href: "/app/smart-money", label: "Smart Wallets", icon: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { group: "", href: "/app/alerts", label: "Alerts", icon: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4" },
  { group: "Account", href: "/app/watchlist", label: "Watchlist", icon: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" },
  { group: "Account", href: "/app/billing", label: "Subscription & Billing", icon: "M3 6h18v12H3V6Zm0 4h18M7 15h3" },
  { group: "Account", href: "/app/settings", label: "Account Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14.3 3h-4.6l-.4 2.4A7 7 0 0 0 7.1 6.7l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3l.4 2.4h4.6l.4-2.4a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z" },
];

export function NavIcon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
