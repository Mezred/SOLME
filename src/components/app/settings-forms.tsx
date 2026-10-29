"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";

function useAction() {
  const [msg, setMsg] = useState<{ tone: "info" | "down"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(body: unknown, success = "Saved.") {
    setBusy(true);
    setMsg(null);
    const r = await apiFetch<{ message?: string }>("/api/settings", { body });
    setBusy(false);
    setMsg(r.ok ? { tone: "info", text: r.data?.message ?? success } : { tone: "down", text: r.error ?? "Failed" });
    return r.ok;
  }
  return { msg, busy, run };
}

const Msg = ({ msg }: { msg: { tone: "info" | "down"; text: string } | null }) => (msg ? <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null);

function Toggle({ id, label, checked, onChange, disabled, hint }: { id: string; label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 accent-up" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-fg-faint">{hint}</span>}</span>
    </label>
  );
}

export function ProfileForm({ initial, telegramConfigured, emailConfigured, channels }: {
  initial: { displayName: string | null; timezone: string; notifyInApp: boolean; notifyEmail: boolean; notifyTelegram: boolean; telegramChatId: string | null };
  telegramConfigured: boolean;
  emailConfigured: boolean;
  channels: string[];
}) {
  const router = useRouter();
  const [f, setF] = useState({ ...initial, telegramChatId: initial.telegramChatId ?? "", displayName: initial.displayName ?? "" });
  const { msg, busy, run } = useAction();
  const tg = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run({ action: "profile", ...f, displayName: f.displayName || null, telegramChatId: f.telegramChatId || null })) router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="s-name" className="label">Display name</label><input id="s-name" className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} maxLength={60} /></div>
        <div><label htmlFor="s-tz" className="label">Timezone</label><input id="s-tz" className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="UTC or Europe/Paris" /></div>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Alert delivery</legend>
        <Toggle id="s-inapp" label="In-app notifications" checked={f.notifyInApp} onChange={(v) => setF({ ...f, notifyInApp: v })} disabled hint="Always on — the inbox is the source of truth." />
        <Toggle id="s-email" label="Email alerts" checked={f.notifyEmail} onChange={(v) => setF({ ...f, notifyEmail: v })} disabled={!channels.includes("email")} hint={!channels.includes("email") ? "Available on Pro" : !emailConfigured ? "Email provider not configured on this server" : undefined} />
        <Toggle id="s-tg" label="Telegram alerts" checked={f.notifyTelegram} onChange={(v) => setF({ ...f, notifyTelegram: v })} disabled={!channels.includes("telegram")} hint={!channels.includes("telegram") ? "Available on Pro" : !telegramConfigured ? "Telegram bot not configured on this server" : !f.telegramChatId ? "Connect Telegram below first" : undefined} />
      </fieldset>
      {channels.includes("telegram") && telegramConfigured && (
        <div className="max-w-md">
          {initial.telegramChatId ? (
            <>
              <p className="text-sm"><span className="text-pos">● Telegram connected</span> <span className="num text-xs text-fg-faint">chat {initial.telegramChatId}</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={tg.busy} onClick={() => tg.run({ action: "telegram_test" })}>Send test message</Button>
                <Button type="button" size="sm" variant="ghost" disabled={tg.busy} onClick={async () => { if (await tg.run({ action: "telegram_unlink" })) router.refresh(); }}>Disconnect</Button>
              </div>
              <Msg msg={tg.msg} />
            </>
          ) : (
            <TelegramConnect />
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-fg-faint hover:text-fg">Enter a chat ID manually</summary>
            <label htmlFor="s-tgid" className="label mt-2">Telegram chat ID</label>
            <input id="s-tgid" className="input num" value={f.telegramChatId} onChange={(e) => setF({ ...f, telegramChatId: e.target.value })} placeholder="e.g. 123456789" />
            <p className="mt-1 text-xs text-fg-faint">Press Start in the bot first, then get your ID from @userinfobot and save.</p>
          </details>
        </div>
      )}
      <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
      <Msg msg={msg} />
    </form>
  );
}

/** Opens the bot with a one-time link, then checks every 3 s (for up to 3 min) until the chat is linked. */
export function TelegramConnect() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "opening" | "waiting" | "expired">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "waiting") return;
    const started = Date.now();
    const id = setInterval(async () => {
      if (Date.now() - started > 3 * 60_000) {
        setState("expired");
        return;
      }
      const r = await apiFetch<{ linked: boolean }>("/api/settings", { body: { action: "telegram_check" } });
      if (r.data?.linked) router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [state, router]);

  async function connect() {
    setError(null);
    setState("opening");
    // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at the link.
    const tab = window.open("", "_blank");
    const r = await apiFetch<{ url: string }>("/api/settings", { body: { action: "telegram_link" } });
    if (!r.ok || !r.data) {
      tab?.close();
      setError(r.error ?? "Could not create a link");
      setState("idle");
      return;
    }
    if (tab) tab.location.href = r.data.url;
    else window.location.href = r.data.url;
    setState("waiting");
  }

  return (
    <div>
      <Button type="button" variant="primary" size="sm" disabled={state === "opening"} onClick={connect}>
        {state === "waiting" ? "Open Telegram again" : "Connect Telegram"}
      </Button>
      <p className="mt-1 text-xs text-fg-faint">
        {state === "waiting"
          ? "Press Start in the Telegram chat that opened. This page updates by itself once it is linked."
          : state === "expired"
            ? "Still not linked. Click Connect Telegram to try again."
            : "Opens our bot in Telegram. Press Start and your alerts will arrive there."}
      </p>
      {error && <Msg msg={{ tone: "down", text: error }} />}
    </div>
  );
}

/** Quiet hours for Telegram alerts (local time) and the 🔕 mutes set from alert buttons. */
export function QuietHoursForm({ initial, mutes }: { initial: { start: string | null; end: string | null }; mutes: number }) {
  const router = useRouter();
  const [f, setF] = useState({ start: initial.start ?? "23:00", end: initial.end ?? "07:00" });
  const [on, setOn] = useState(Boolean(initial.start));
  const { msg, busy, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run({ action: "quiet_hours", start: on ? f.start : null, end: on ? f.end : null });
      }}
    >
      <Toggle id="qh-on" label="Quiet hours" checked={on} onChange={setOn} hint="Telegram alerts in this window are held and sent as one summary when it ends. Uses your timezone above." />
      {on && (
        <div className="flex flex-wrap items-end gap-3">
          <div><label htmlFor="qh-s" className="label">From</label><input id="qh-s" type="time" className="input num w-32" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></div>
          <div><label htmlFor="qh-e" className="label">To</label><input id="qh-e" type="time" className="input num w-32" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        {mutes > 0 && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={async () => { if (await run({ action: "clear_mutes" })) router.refresh(); }}>
            Clear {mutes} mute{mutes === 1 ? "" : "s"}
          </Button>
        )}
      </div>
      <p className="text-xs text-fg-faint">Tap 🔕 under a Telegram alert to mute that coin, dev or wallet for 24h. In the chat, /mutes lists them and /unmute clears them.</p>
      <Msg msg={msg} />
    </form>
  );
}

export function PasswordForm() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const { msg, busy, run } = useAction();
  return (
    <form
      className="grid max-w-xl gap-3 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (f.next !== f.confirm) return;
        if (await run({ action: "password", current: f.current, next: f.next })) setF({ current: "", next: "", confirm: "" });
      }}
    >
      <div><label htmlFor="pw-c" className="label">Current</label><input id="pw-c" type="password" autoComplete="current-password" className="input" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></div>
      <div><label htmlFor="pw-n" className="label">New</label><input id="pw-n" type="password" autoComplete="new-password" className="input" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></div>
      <div><label htmlFor="pw-r" className="label">Confirm new</label><input id="pw-r" type="password" autoComplete="new-password" className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></div>
      {f.confirm && f.next !== f.confirm && <p className="text-xs text-down sm:col-span-3">Passwords do not match.</p>}
      <div className="sm:col-span-3"><Button type="submit" disabled={busy || f.next !== f.confirm}>{busy ? "Updating…" : "Change password"}</Button><Msg msg={msg} /></div>
    </form>
  );
}

export function SessionActions({ id, current }: { id?: string; current?: boolean }) {
  const router = useRouter();
  const { busy, run } = useAction();
  if (current) return <span className="text-xs text-up">This device</span>;
  return (
    <button disabled={busy} className="text-xs text-fg-faint hover:text-down" onClick={async () => { if (await run(id ? { action: "revoke_session", sessionId: id } : { action: "revoke_others" })) router.refresh(); }}>
      {id ? "Revoke" : "Sign out all other sessions"}
    </button>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { msg, busy, run } = useAction();
  if (!open) return <Button variant="danger" size="sm" onClick={() => setOpen(true)}>Delete account…</Button>;
  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run({ action: "delete_account", password, confirm })) {
          router.replace("/");
          router.refresh();
        }
      }}
    >
      <Notice tone="down">This permanently deletes your account, watchlists, screener templates, alerts and Telegram link. It cannot be undone.</Notice>
      <div><label htmlFor="del-pw" className="label">Password</label><input id="del-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <div><label htmlFor="del-c" className="label">Type DELETE to confirm</label><input id="del-c" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
      <div className="flex gap-2"><Button type="submit" variant="danger" disabled={busy || confirm !== "DELETE"}>Permanently delete</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
      <Msg msg={msg} />
    </form>
  );
}
