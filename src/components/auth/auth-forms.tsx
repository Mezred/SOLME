"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";
import { apiFetch } from "@/lib/client";

function safeNext(next: string | null) {
  // Only allow same-site relative paths to prevent open redirects.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

function Shell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 border-t border-line pt-4 text-center text-sm text-fg-muted">{footer}</div>}
    </div>
  );
}

function Field({ id, label, type = "text", value, onChange, autoComplete, hint }: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} name={id} type={type} required value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className="input" aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-fg-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">
      {error}
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/auth/login", { body: { email, password } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <Shell title="Log in" subtitle="Welcome back to the terminal." footer={<>New to NEXALPHA? <Link href="/signup" className="text-up hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-fg-muted hover:text-fg">
            Forgot password?
          </Link>
        </div>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Log in"}
        </Button>
      </form>
    </Shell>
  );
}

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accept) return setError("Please accept the Terms of Service and Risk Disclaimer.");
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ devVerifyUrl?: string }>("/api/auth/signup", { body: { email, password, acceptTerms: true } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.data?.devVerifyUrl) return setDevUrl(r.data.devVerifyUrl);
    const plan = params.get("plan");
    router.replace(plan && plan !== "free" ? `/app/billing?plan=${plan}&interval=${params.get("interval") ?? "month"}` : "/app?welcome=1");
    router.refresh();
  }

  if (devUrl) {
    return (
      <Shell title="Account created" subtitle="Check your inbox to verify your email.">
        <Notice tone="warn" title="Development mode: email delivery is not configured">
          The verification email was logged on the server instead of sent. Use this link to verify:{" "}
          <a href={devUrl} className="break-all text-up underline">
            verify email
          </a>
        </Notice>
        <Button variant="primary" size="lg" className="mt-5 w-full" onClick={() => { router.replace("/app?welcome=1"); router.refresh(); }}>
          Continue to dashboard
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title="Create your account" subtitle="Free plan — no card required." footer={<>Already have an account? <Link href="/login" className="text-up hover:underline">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 10 characters. A passphrase works well." />
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1fe08a]" />
          <span>
            I agree to the <Link href="/terms" className="text-fg underline">Terms of Service</Link> and have read the{" "}
            <Link href="/risk" className="text-fg underline">Risk Disclaimer</Link> and <Link href="/privacy" className="text-fg underline">Privacy Policy</Link>. I understand signals are not financial advice.
          </span>
        </label>
        <ErrorText error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </Shell>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<{ message: string; devResetUrl?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ message: string; devResetUrl?: string }>("/api/auth/forgot-password", { body: { email } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
  }

  return (
    <Shell title="Reset your password" subtitle="We'll email you a single-use link." footer={<Link href="/login" className="text-up hover:underline">Back to log in</Link>}>
      {done ? (
        <div className="space-y-3">
          <Notice tone="info">{done.message}</Notice>
          {done.devResetUrl && (
            <Notice tone="warn" title="Development mode: email delivery is not configured">
              <a href={done.devResetUrl} className="break-all text-up underline">
                Open reset link
              </a>
            </Notice>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <ErrorText error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    const r = await apiFetch("/api/auth/reset-password", { body: { token, password } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.replace("/app?reset=1");
    router.refresh();
  }

  if (!token) {
    return (
      <Shell title="Invalid link">
        <Notice tone="down">This reset link is missing its token. Request a new one.</Notice>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-up hover:underline">
          Request a new link
        </Link>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password" subtitle="All other sessions will be signed out.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 10 characters." />
        <Field id="confirm" label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <ErrorText error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </Shell>
  );
}
