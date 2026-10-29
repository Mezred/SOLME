import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Monospace for the interface (terminal style); a tight sans for big marketing headlines (`font-display`).
const term = JetBrains_Mono({ variable: "--font-term", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const display = Inter_Tight({ variable: "--font-headline", subsets: ["latin"], weight: ["600", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "SOLME — Find memecoins early, skip the scams", template: "%s · SOLME" },
  description:
    "Solana memecoin intelligence: Early Coins, Coin Check, Proven Devs, Smart Wallets and Telegram alerts.",
  openGraph: { siteName: "SOLME", type: "website" },
};

export const viewport: Viewport = { themeColor: "#04060a", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${term.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
