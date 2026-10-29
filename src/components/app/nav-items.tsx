export interface NavItem {
  href: string;
  label: string;
  /** Short label for the phone tab bar. */
  short: string;
  icon: string;
  group: "main" | "account";
}

/**
 * SOLME is four features plus Alerts. Early Coins is home; the account group holds the rest (Watchlist, followed
 * wallets, Billing, Settings). Icons are SVG path data (24×24, stroke).
 */
export const NAV: NavItem[] = [
  { group: "main", href: "/app", label: "Early Coins", short: "Early", icon: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z" },
  { group: "main", href: "/app/check", label: "Coin Check", short: "Check", icon: "M9 12l2 2 4-4M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3Z" },
  { group: "main", href: "/app/smart-dev", label: "Proven Devs", short: "Devs", icon: "M8 9l-4 3 4 3m8-6 4 3-4 3M14 5l-4 14" },
  { group: "main", href: "/app/smart-money", label: "Smart Wallets", short: "Wallets", icon: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0 2-3h11v3m0 7h2" },
  { group: "main", href: "/app/alerts", label: "Alerts", short: "Alerts", icon: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4" },
  { group: "account", href: "/app/watchlist", label: "Watchlist", short: "Watchlist", icon: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" },
  { group: "account", href: "/app/wallets", label: "Followed wallets", short: "Following", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 21a8 8 0 0 1 16 0" },
  { group: "account", href: "/app/billing", label: "Billing", short: "Billing", icon: "M3 6h18v12H3V6Zm0 4h18M7 15h3" },
  { group: "account", href: "/app/settings", label: "Settings", short: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14.3 3h-4.6l-.4 2.4A7 7 0 0 0 7.1 6.7l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3l.4 2.4h4.6l.4-2.4a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z" },
];

export function NavIcon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
