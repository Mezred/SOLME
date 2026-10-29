import type { ReactNode } from "react";
import { CHAIN_IDS, CHAINS } from "@/lib/chains";
import { cx } from "@/components/ui";

export function Section({ id, eyebrow, title, intro, children, className = "", as: Heading = "h2" }: { id?: string; eyebrow?: string; title: ReactNode; intro?: ReactNode; children?: ReactNode; className?: string; as?: "h1" | "h2" }) {
  return (
    <section id={id} className={cx("mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-20", className)}>
      {eyebrow && <p className="num text-xs font-medium uppercase tracking-[0.18em] text-up">{eyebrow}</p>}
      <Heading className="mt-2 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</Heading>
      {intro && <p className="mt-3 max-w-2xl text-fg-muted">{intro}</p>}
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}

export function ChainStrip() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {CHAIN_IDS.map((id) => (
        <div key={id} className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2">
          <span className="h-2 w-2 bg-up" aria-hidden="true" />
          <span className="text-sm font-medium">{CHAINS[id].name}</span>
          <span className="num text-[11px] text-fg-faint">pump.fun · LetsBonk · every Solana DEX</span>
        </div>
      ))}
    </div>
  );
}

export function FeatureCard({ icon, title, children, tone = "up" }: { icon: ReactNode; title: string; children: ReactNode; tone?: "up" | "ai" | "down" | "info" }) {
  const ring = { up: "text-up bg-up/10", ai: "text-ai bg-ai/10", down: "text-down bg-down/10", info: "text-info bg-info/10" }[tone];
  return (
    <div className="card p-5">
      <div className={cx("inline-flex h-9 w-9 items-center justify-center rounded-lg", ring)}>{icon}</div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <div className="mt-1.5 text-sm leading-relaxed text-fg-muted">{children}</div>
    </div>
  );
}

const I = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const Icons = {
  radar: I("M12 12 19 5M21 12a9 9 0 1 1-9-9M17 12a5 5 0 1 1-5-5M12 12h.01"),
  brain: I("M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 3 5h2V4Zm6 0a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-3 5h-2V4Z"),
  shield: I("M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Zm-3 9 2 2 4-4"),
  wallet: I("M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Zm0 0 2-3h11v3M17 14h.01"),
  bell: I("M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4"),
  chart: I("M4 19h16M6 15l4-4 3 3 5-6"),
  rocket: I("M5 15c-1 1-1.5 3.5-1.5 5.5 2 0 4.5-.5 5.5-1.5M14 4c3 0 6 3 6 6-2 4-5 6-8 7l-5-5c1-3 3-6 7-8Zm1 5h.01"),
  chat: I("M4 5h16v11H8l-4 4V5Zm4 5h8M8 8h5"),
};
