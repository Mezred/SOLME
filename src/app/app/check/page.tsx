import type { Metadata } from "next";
import { CheckForm } from "@/components/app/check-form";
import { Card, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Check a coin" };

const CHECKS = [
  ["Can I sell it?", "a real sell simulated on-chain: route, price impact, hidden tax, freeze or transfer hooks"],
  ["Is the liquidity real?", "pool size, real SOL in it, market cap vs pool, LP burned, liquidity pulled"],
  ["Who controls it?", "mint and freeze authority, the dev's wallet and launch record"],
  ["Are insiders set to dump?", "top holders, bundle, snipers, dev sells, wallets funded by the dev or one funder"],
  ["Is the trading genuine?", "wash trading, bot buys, one wallet driving volume"],
]

export default async function CheckPage({ searchParams }: PageProps<"/app/check">) {
  await requirePageUser("/app/check");
  const sp = await searchParams;
  const initial = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  return (
    <>
      <PageHeader title="Check a coin" description="Five questions, one answer: Tradeable, Watch or Avoid." />
      <Card className="p-4 sm:p-6">
        <CheckForm initial={initial} />
        <dl className="mt-6 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          {CHECKS.map(([k, v]) => (
            <div key={k}>
              <dt className="inline text-fg">{k}</dt> <dd className="inline text-fg-faint">— {v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <p className="mt-4 text-[11px] text-fg-faint">Solana contracts (pump.fun, LetsBonk and any Solana DEX). Any failed check means Avoid, whatever the score.</p>
    </>
  );
}
