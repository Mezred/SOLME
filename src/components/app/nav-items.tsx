export interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
}

/** Sidebar navigation. Icons are SVG path data (24×24, stroke). */
export const NAV: NavItem[] = [
  { group: "Markets", href: "/app", label: "Overview", icon: "M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-4H4v4ZM14 4v4h6V4h-6Z" },
  { group: "Markets", href: "/app/signals", label: "Live Signals", icon: "M3 12h4l3-8 4 16 3-8h4" },
  { group: "Markets", href: "/app/discover", label: "Discover Tokens", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5 5.5-2 5-5 2 2-5 5-2Z" },
  { group: "Markets", href: "/app/screener", label: "Token Screener", icon: "M4 5h16M7 12h10M10 19h4" },
  { group: "Markets", href: "/app/launches", label: "New Launches", icon: "M5 15c-1 1-1.5 3.5-1.5 5.5 2 0 4.5-.5 5.5-1.5M14 4c3 0 6 3 6 6-2 4-5 6-8 7l-5-5c1-3 3-6 7-8Z" },
  { group: "Markets", href: "/app/intelligence", label: "Market Intelligence", icon: "M4 19V9m5 10V5m5 14v-7m5 7V8" },
  { group: "Wallets", href: "/app/smart-money", label: "Smart Money", icon: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { group: "Wallets", href: "/app/wallets", label: "Whale Tracker", icon: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0 2-3h11v3M17 14h.01" },
  { group: "Tracking", href: "/app/watchlist", label: "Watchlist", icon: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" },
  { group: "Tracking", href: "/app/portfolio", label: "Portfolio", icon: "M12 3a9 9 0 1 0 9 9h-9V3Zm3 0v6h6a6 6 0 0 0-6-6Z" },
  { group: "Tracking", href: "/app/positions", label: "Open Positions", icon: "M4 7h16v12H4V7Zm4-3h8v3H8V4Zm-4 8h16" },
  { group: "Tracking", href: "/app/alerts", label: "Alerts", icon: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4" },
  { group: "Research", href: "/app/ai", label: "AI Analysis", icon: "M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 3 5h2V4Zm6 0a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-3 5h-2V4Z" },
  { group: "Research", href: "/app/chat", label: "AI Chat", icon: "M4 5h16v11H8l-4 4V5Zm4 5h8M8 8h5" },
  { group: "Research", href: "/app/strategies", label: "Strategy Templates", icon: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 3.5h7M16.5 13v7" },
  { group: "Research", href: "/app/history", label: "Signal History", icon: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5m4-1v5l3 2" },
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
