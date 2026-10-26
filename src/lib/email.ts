import { query, queryOne } from "@/lib/db";
import { env, integrations } from "@/lib/env";
import { errorMessage, logger } from "@/lib/log";

const log = logger("email");

/**
 * Sends a transactional email through Resend when RESEND_API_KEY is set. Without it, the message is
 * recorded in email_outbox with status 'logged' and printed to the server log (development only).
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ delivered: boolean }> {
  const row = await queryOne<{ id: string }>(
    "INSERT INTO email_outbox (to_email, subject, body_text) VALUES ($1, $2, $3) RETURNING id",
    [to, subject, text],
  );
  const id = row!.id;

  if (!integrations.email) {
    await query("UPDATE email_outbox SET status = 'logged' WHERE id = $1", [id]);
    log.info("Email provider not configured; message logged instead of sent", { to, subject, body: text });
    return { delivered: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(body.message ?? `Resend HTTP ${res.status}`);
    await query("UPDATE email_outbox SET status = 'sent', sent_at = now(), provider_message_id = $2 WHERE id = $1", [
      id,
      body.id ?? null,
    ]);
    return { delivered: true };
  } catch (err) {
    await query("UPDATE email_outbox SET status = 'failed', error = $2 WHERE id = $1", [id, errorMessage(err)]);
    log.error("Email delivery failed", { to, subject, error: errorMessage(err) });
    throw err;
  }
}
