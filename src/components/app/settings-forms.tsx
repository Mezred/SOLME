"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
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
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1fe08a]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
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
        <Toggle id="s-tg" label="Telegram alerts" checked={f.notifyTelegram} onChange={(v) => setF({ ...f, notifyTelegram: v })} disabled={!channels.includes("telegram")} hint={!channels.includes("telegram") ? "Available on Pro" : !telegramConfigured ? "Telegram bot not configured on this server" : undefined} />
      </fieldset>
      {channels.includes("telegram") && (
        <div className="max-w-sm">
          <label htmlFor="s-tgid" className="label">Telegram chat ID</label>
          <input id="s-tgid" className="input num" value={f.telegramChatId} onChange={(e) => setF({ ...f, telegramChatId: e.target.value })} placeholder="e.g. 123456789" />
          <p className="mt-1 text-xs text-fg-faint">Start a chat with the NEXALPHA bot, send /start, then paste the numeric chat ID it replies with.</p>
          <Button type="button" size="sm" className="mt-2" disabled={tg.busy || !telegramConfigured} onClick={() => tg.run({ action: "telegram_test" })}>Send test message</Button>
          <Msg msg={tg.msg} />
        </div>
      )}
      <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>
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
      <Notice tone="down">This permanently deletes your account, watchlists, portfolios, alerts and AI conversations. It cannot be undone.</Notice>
      <div><label htmlFor="del-pw" className="label">Password</label><input id="del-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <div><label htmlFor="del-c" className="label">Type DELETE to confirm</label><input id="del-c" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
      <div className="flex gap-2"><Button type="submit" variant="danger" disabled={busy || confirm !== "DELETE"}>Permanently delete</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
      <Msg msg={msg} />
    </form>
  );
}
