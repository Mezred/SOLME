import type { CSSProperties, ReactNode } from "react";

/**
 * Landing-page hero visual: a phone receiving SOLME's Telegram alerts, one after another, the way they really look
 * (headline, coin line, tap-to-copy contract, facts, scam check, buttons). The first alert's scam check flips from
 * "running" to "passed". Illustrative content, labelled as such; CSS-only animation (see globals.css), off for
 * reduced motion.
 */
export function AlertShowcase() {
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      {/* Glow behind the phone */}
      <div className="hero-glow pointer-events-none absolute -inset-16 -z-10" aria-hidden="true" />

      <div className="rounded-[2.2rem] border border-line-strong bg-ink-900 p-2.5 shadow-[0_30px_80px_-20px_rgba(179,136,255,0.35)]">
        <div className="overflow-hidden rounded-[1.7rem] border border-line bg-ink-950">
          {/* Chat header */}
          <div className="flex items-center gap-3 border-b border-line bg-ink-850 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-up font-display text-base font-bold text-ink-950">S</span>
            <div className="min-w-0 text-left">
              <div className="text-sm font-semibold text-fg">SOLME</div>
              <div className="text-[11px] text-up">bot · online</div>
            </div>
            <span className="ml-auto text-[10px] uppercase tracking-widest text-fg-faint">example</span>
          </div>

          {/* Fixed height with a fade at the bottom: the chat keeps going below. */}
          <div className="chat-fade h-[480px] overflow-hidden px-3 py-4 text-left">
          {/* Scrolls up when the third alert arrives, like a real chat. */}
          <div className="chat-scroll space-y-3" role="list" aria-label="Example SOLME alerts on Telegram">
            <Alert delay={0.3} icon="🚀" title="PROVEN DEV JUST LAUNCHED" coin="$LUNA · Solana · pump.fun" contract="7xKp4Q…9dRpump"
              facts={[["Dev score", "82"], ["Earlier launches", "6 · 3 migrated"], ["Dev buy", "1.2 SOL"]]}
              check
              buttons={["DexScreener", "pump.fun"]} mute={["🔕 Dev 24h", "🔕 Coin 24h"]}
            />
            <Alert delay={2.6} icon="👥" title="3 SMART WALLETS BOUGHT" coin="$ORBIT · Solana" contract="Hq2mV8…kE7bonk"
              facts={[["Wallets", "3 (best score 91)"], ["Total spent", "14.5 SOL"], ["Within", "6 min"]]}
              buttons={["DexScreener", "Explorer"]}
            />
            <Alert delay={4.6} icon="🔎" title='MATCHES "FRESH MOVERS"' coin="$PIXL · Solana" contract="Cw9rT1…aX3pump"
              facts={[["Market cap", "$412K"], ["1h / 24h", "+38% / +212%"]]}
            />
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Alert({ delay, icon, title, coin, contract, facts, check, buttons, mute }: {
  delay: number;
  icon: string;
  title: string;
  coin: string;
  contract: string;
  facts: [string, string][];
  check?: boolean;
  buttons?: string[];
  mute?: string[];
}) {
  const style = { "--d": `${delay}s` } as CSSProperties;
  return (
    <div className="alert-in" style={style} role="listitem">
      <div className="rounded-2xl rounded-tl-sm border border-line bg-ink-800 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg">
        <div className="font-semibold">{icon} {title}</div>
        <div className="mt-1.5 font-semibold">{coin}</div>
        <div className="num mt-0.5 inline-block rounded bg-ink-950 px-1.5 py-0.5 text-[11px] text-up">{contract}</div>
        <ul className="mt-1.5 space-y-0.5 text-fg-muted">
          {facts.map(([k, v]) => (
            <li key={k}>• {k}: <b className="text-fg">{v}</b></li>
          ))}
        </ul>
        {check && (
          <div className="relative mt-2 h-5">
            <span className="check-pending absolute inset-0" style={style}>⏳ <b>Scam check running…</b></span>
            <span className="check-done absolute inset-0 text-up" style={style}>✅ <b>Scam check passed</b></span>
          </div>
        )}
      </div>
      {(buttons || mute) && (
        <div className="mt-1 space-y-1">
          {buttons && <ButtonRow>{buttons}</ButtonRow>}
          {mute && <ButtonRow>{mute}</ButtonRow>}
        </div>
      )}
    </div>
  );
}

function ButtonRow({ children }: { children: ReactNode[] | string[] }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {(children as string[]).map((b) => (
        <span key={b} className="rounded-lg bg-ink-750 py-1.5 text-center text-[11px] text-fg-muted">{b}</span>
      ))}
    </div>
  );
}
