import { z } from "zod";
import { getCurrentUser, clientIp } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/entitlements";
import { query } from "@/lib/db";
import { api, enforceRateLimit, ok, parseBody } from "@/lib/http";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(0).optional(), // honeypot field — must stay empty
});

/** Public contact/support form. Signed-in Elite users are flagged as priority. */
export const POST = api(async (req) => {
  const ip = (await clientIp()) ?? "unknown";
  await enforceRateLimit(`support:${ip}`, 5, 3600);
  const b = await parseBody(req, schema);
  const user = await getCurrentUser();
  const priority = user ? (await getEntitlements(user.id)).features.priority_support : false;
  await query("INSERT INTO support_tickets (user_id, email, subject, message, priority) VALUES ($1, $2, $3, $4, $5)", [
    user?.id ?? null,
    b.email,
    b.subject,
    b.message,
    priority ? "priority" : "normal",
  ]);
  return ok({ ok: true });
});
