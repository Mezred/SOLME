import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "NEXALPHA — On-chain signal intelligence", template: "%s · NEXALPHA" },
  description:
    "Multi-chain DEX token research: explainable AI scores, security checks, liquidity context, wallet intelligence and alerts for Solana, Ethereum, BNB Smart Chain and Base.",
  openGraph: { siteName: "NEXALPHA", type: "website" },
};

export const viewport: Viewport = { themeColor: "#04060b", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
