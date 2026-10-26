"use client";

import { useState, type FormEvent } from "react";
import { Button, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";

export function ContactForm() {
  const [f, setF] = useState({ email: "", subject: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy");
    const r = await apiFetch("/api/support", { body: f });
    if (!r.ok) {
      setState("idle");
      return setError(r.error);
    }
    setState("done");
  }
  if (state === "done") return <Notice tone="info" title="Message received">Thanks — we reply by email, usually within one business day (priority for Elite).</Notice>;
  return (
    <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
      <div><label htmlFor="c-email" className="label">Email</label><input id="c-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" /></div>
      <div><label htmlFor="c-subject" className="label">Subject</label><input id="c-subject" className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required maxLength={120} /></div>
      <div><label htmlFor="c-msg" className="label">Message</label><textarea id="c-msg" rows={6} className="input" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required maxLength={5000} /></div>
      <div className="hidden" aria-hidden="true"><label htmlFor="c-web">Website</label><input id="c-web" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
      {error && <p role="alert" className="text-sm text-down">{error}</p>}
      <Button type="submit" variant="primary" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
