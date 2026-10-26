"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, cx, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";
import { timeAgo } from "@/lib/format";
import { Markdown } from "./markdown";

interface Source {
  type: string;
  id: string;
  label: string;
  as_of: string | null;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}
interface Conv {
  id: string;
  title: string;
  updated_at: string;
}

const SUGGESTIONS = [
  "What does the market look like right now across my chains?",
  "Explain the highest-scoring active signal and what could invalidate it.",
  "Compare the top two accumulation signals on liquidity, holder concentration and security.",
  "Which tokens on my watchlist have security warnings?",
];

function sourceHref(s: Source) {
  if (s.type === "wallet") return `/app/wallets/${s.id}`;
  if (s.type === "token") return `/app/screener?q=${encodeURIComponent(s.label.split(" ")[0])}`;
  return null;
}

export function AiChat({ configured, used, limit, initialPrompt }: { configured: boolean; used: number; limit: number; initialPrompt?: string }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [convId, setConvId] = useState<string | undefined>();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(used);
  const bottom = useRef<HTMLDivElement>(null);

  const loadConvs = async () => {
    const r = await apiFetch<{ conversations: Conv[] }>("/api/ai/conversations");
    setConvs(r.data?.conversations ?? []);
  };
  useEffect(() => {
    void loadConvs();
  }, []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function open(id: string) {
    setConvId(id);
    setError(null);
    const r = await apiFetch<{ messages: Msg[] }>(`/api/ai/conversations?id=${id}`);
    setMsgs(r.data?.messages ?? []);
  }

  async function send(e?: FormEvent, text?: string) {
    e?.preventDefault();
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ conversationId: string; reply: string; sources: Source[] }>("/api/ai/chat", { body: { message, conversationId: convId } });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      setMsgs((m) => m.slice(0, -1));
      setInput(message);
      return;
    }
    setConvId(r.data!.conversationId);
    setMsgs((m) => [...m, { role: "assistant", content: r.data!.reply, sources: r.data!.sources }]);
    setCount((c) => c + 1);
    void loadConvs();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="card hidden max-h-[70vh] overflow-y-auto p-2 lg:block" aria-label="Conversations">
        <Button size="sm" className="mb-2 w-full" onClick={() => { setConvId(undefined); setMsgs([]); setError(null); }}>+ New chat</Button>
        {convs.length === 0 && <p className="px-2 py-3 text-xs text-fg-faint">No conversations yet.</p>}
        {convs.map((c) => (
          <button key={c.id} onClick={() => open(c.id)} className={cx("block w-full truncate rounded px-2 py-1.5 text-left text-xs", c.id === convId ? "bg-ink-700 text-fg" : "text-fg-muted hover:bg-ink-750")}>
            {c.title}
            <span className="block text-[10px] text-fg-faint">{timeAgo(c.updated_at)}</span>
          </button>
        ))}
      </aside>
      <section className="card flex min-h-[70vh] flex-col" aria-label="Chat">
        <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-fg-faint">
          <span>Answers use only NEXALPHA data tools · every figure cites its timestamp</span>
          <span className="num">{count}/{limit} today</span>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {!configured && <Notice tone="warn" title="AI is not configured">Set ANTHROPIC_API_KEY on the server to enable chat. Scores and reports elsewhere still work — they are deterministic.</Notice>}
          {msgs.length === 0 && configured && (
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(undefined, s)} className="rounded-lg border border-line bg-ink-900 p-3 text-left text-sm text-fg-muted hover:border-ai/40 hover:text-fg">{s}</button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cx("max-w-3xl", m.role === "user" ? "ml-auto" : "")}>
              {m.role === "user" ? (
                <div className="rounded-lg bg-ink-700 px-3.5 py-2 text-sm">{m.content}</div>
              ) : (
                <div className="rounded-lg border border-ai/20 bg-ai/5 px-4 py-3">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-[#b9adff]"><Badge tone="ai">AI</Badge> grounded in NEXALPHA data · not financial advice</div>
                  <Markdown text={m.content} />
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ai/15 pt-2">
                      {m.sources.map((s, j) => {
                        const href = sourceHref(s);
                        const chip = <Badge tone="neutral" title={s.as_of ?? undefined}>{s.label}{s.as_of ? ` · ${timeAgo(s.as_of)}` : ""}</Badge>;
                        return href ? <Link key={j} href={href}>{chip}</Link> : <span key={j}>{chip}</span>;
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-fg-faint"><span className="h-2 w-2 animate-pulse-dot rounded-full bg-ai" /> Retrieving data and analyzing…</div>}
          <div ref={bottom} />
        </div>
        {error && <p role="alert" className="mx-4 mb-2 rounded border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
        <form onSubmit={send} className="flex gap-2 border-t border-line p-3">
          <label htmlFor="ai-input" className="sr-only">Message</label>
          <textarea
            id="ai-input"
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={configured ? "Ask about a token, signal, wallet or the market…" : "AI not configured"}
            disabled={!configured || busy}
            maxLength={4000}
            className="input flex-1 resize-none"
          />
          <Button type="submit" variant="ai" disabled={!configured || busy || !input.trim()}>Send</Button>
        </form>
      </section>
    </div>
  );
}

export function AnalysisButton({ tokenId, symbol, configured, allowed }: { tokenId: string; symbol: string; configured: boolean; allowed: boolean }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ reply: string; sources: Source[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!configured) return <Notice tone="warn">AI narrative unavailable: ANTHROPIC_API_KEY is not configured. The deterministic report above is complete on its own.</Notice>;
  if (!allowed) return <Notice tone="ai">Deep AI research reports are available on Pro and Elite. <Link href="/app/billing" className="underline">Upgrade</Link></Notice>;
  return (
    <div>
      {!report && (
        <Button
          variant="ai"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await apiFetch<{ reply: string; sources: Source[] }>("/api/ai/chat", {
              body: {
                kind: "analysis",
                message: `Write a research report on token_id ${tokenId} (${symbol}). Call get_token_report and get_token_signals first. Structure: 1) Snapshot (with timestamps) 2) What the score says and why (strongest and weakest factors) 3) Security findings and what is unverified 4) Liquidity & holder risks 5) Recent signal track record for this token 6) Scenarios: what would strengthen or invalidate the current picture 7) Data gaps. No price predictions, no buy/sell advice.`,
              },
            });
            setBusy(false);
            if (!r.ok) return setError(r.error);
            setReport(r.data);
          }}
        >
          {busy ? "Generating report… (can take a minute)" : "Generate AI research report"}
        </Button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-down">{error}</p>}
      {report && (
        <div className="rounded-lg border border-ai/20 bg-ai/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs text-[#b9adff]"><Badge tone="ai">AI report</Badge> generated from the data shown on this page · not financial advice</div>
          <Markdown text={report.reply} />
        </div>
      )}
    </div>
  );
}
