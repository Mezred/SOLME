import { z } from "zod";
import { audit } from "@/lib/audit";
import { pollTelegramUpdates, sendTelegramHtml, telegramLinkUrl } from "@/lib/alerts/telegram";
import { formatTelegramAlert } from "@/lib/alerts/telegram-format";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/auth/password";
import { clientIp, destroySession, revokeAllSessions } from "@/lib/auth/session";
import { query, queryOne, withUser } from "@/lib/db";
import { env, integrations } from "@/lib/env";
import { api, badRequest, enforceRateLimit, ok, parseBody, requireUser } from "@/lib/http";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("profile"),
    displayName: z.string().trim().max(60).nullable(),
    timezone: z.string().trim().max(64),
    notifyInApp: z.boolean(),
    notifyEmail: z.boolean(),
    notifyTelegram: z.boolean(),
    telegramChatId: z.string().trim().regex(/^-?\d{4,20}$/, "Telegram chat ID must be numeric").nullable(),
  }),
  z.object({ action: z.literal("password"), current: z.string().min(1).max(200), next: z.string().min(1).max(200) }),
  z.object({ action: z.literal("revoke_session"), sessionId: z.string().uuid() }),
  z.object({ action: z.literal("revoke_others") }),
  z.object({ action: z.literal("telegram_test") }),
  z.object({ action: z.literal("telegram_link") }),
  z.object({ action: z.literal("telegram_check") }),
  z.object({ action: z.literal("telegram_unlink") }),
  // Quiet hours (local time); both null switches them off.
  z.object({
    action: z.literal("quiet_hours"),
    start: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM").nullable(),
    end: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM").nullable(),
  }),
  z.object({ action: z.literal("clear_mutes") }),
  z.object({ action: z.literal("delete_account"), password: z.string().min(1).max(200), confirm: z.literal("DELETE") }),
]);

export const POST = api(async (req) => {
  const user = await requireUser();
  const body = await parseBody(req, schema);
  const ip = await clientIp();

  switch (body.action) {
    case "profile": {
      if (body.timezone && !Intl.supportedValuesOf("timeZone").includes(body.timezone) && body.timezone !== "UTC") throw badRequest("Unknown timezone");
      if (body.notifyTelegram && !body.telegramChatId) throw badRequest("Connect Telegram first to enable Telegram alerts.");
      await withUser(user.id, (tx) =>
        tx.query(
          `UPDATE profiles SET display_name = $2, timezone = $3, notify_in_app = $4, notify_email = $5, notify_telegram = $6, telegram_chat_id = $7, updated_at = now()
           WHERE user_id = $1`,
          [user.id, body.displayName || null, body.timezone || "UTC", body.notifyInApp, body.notifyEmail, body.notifyTelegram, body.telegramChatId],
        ),
      );
      return ok({ ok: true });
    }
    case "password": {
      await enforceRateLimit(`pwchange:${user.id}`, 5, 900);
      const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      if (!(await verifyPassword(body.current, row?.password_hash ?? null))) throw badRequest("Current password is incorrect.");
      const problem = passwordProblems(body.next, user.email);
      if (problem) throw badRequest(problem);
      await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [user.id, await hashPassword(body.next)]);
      await revokeAllSessions(user.id, user.sessionId);
      await audit(user.id, "auth.password_changed", { type: "user", id: user.id }, {}, ip);
      return ok({ ok: true, message: "Password updated. Other sessions were signed out." });
    }
    case "revoke_session": {
      await query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [body.sessionId, user.id]);
      await audit(user.id, "auth.session_revoked", { type: "session", id: body.sessionId }, {}, ip);
      return ok({ ok: true });
    }
    case "revoke_others": {
      await revokeAllSessions(user.id, user.sessionId);
      await audit(user.id, "auth.sessions_revoked", { type: "user", id: user.id }, {}, ip);
      return ok({ ok: true });
    }
    case "telegram_test": {
      await enforceRateLimit(`tgtest:${user.id}`, 3, 300);
      const p = await queryOne<{ telegram_chat_id: string | null }>("SELECT telegram_chat_id FROM profiles WHERE user_id = $1", [user.id]);
      if (!p?.telegram_chat_id) throw badRequest("Save a Telegram chat ID first.");
      // A sample alert in the real layout, so the user sees exactly what alerts will look like.
      const sample = formatTelegramAlert(
        {
          icon: "✅",
          headline: "Test alert: Telegram is connected",
          symbol: "BONK",
          chain: "solana",
          address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
          facts: [["Example", "this is how alerts look"], ["Copy", "tap the address above"]],
          note: "Sample only — not a signal to buy.",
        },
        `${env.appUrl}/app/alerts`,
      );
      await sendTelegramHtml(p.telegram_chat_id, sample.text, sample.buttons).catch((e) => {
        throw badRequest(e instanceof Error ? e.message : "Telegram delivery failed");
      });
      return ok({ ok: true, message: "Test message sent." });
    }
    case "telegram_link": {
      if (!integrations.telegram) throw badRequest("Telegram bot is not configured on this server.");
      await enforceRateLimit(`tglink:${user.id}`, 5, 300);
      return ok({ url: await telegramLinkUrl(user.id) });
    }
    case "telegram_check": {
      // The settings page polls this while the user presses Start, so linking does not wait for the worker.
      await enforceRateLimit(`tgcheck:${user.id}`, 60, 300);
      if (integrations.telegram) await pollTelegramUpdates().catch(() => 0);
      const p = await queryOne<{ telegram_chat_id: string | null }>("SELECT telegram_chat_id FROM profiles WHERE user_id = $1", [user.id]);
      return ok({ linked: Boolean(p?.telegram_chat_id) });
    }
    case "quiet_hours": {
      if ((body.start === null) !== (body.end === null) || (body.start && body.start === body.end)) throw badRequest("Set both a start and an end time (different), or turn quiet hours off.");
      await query("UPDATE profiles SET quiet_start = $2, quiet_end = $3, updated_at = now() WHERE user_id = $1", [user.id, body.start, body.end]);
      return ok({ ok: true, message: body.start ? `Quiet hours ${body.start}–${body.end} saved. Alerts in that window arrive as one summary afterwards.` : "Quiet hours off." });
    }
    case "clear_mutes": {
      await query("DELETE FROM alert_mutes WHERE user_id = $1", [user.id]);
      return ok({ ok: true, message: "All mutes cleared." });
    }
    case "telegram_unlink": {
      await query("UPDATE profiles SET telegram_chat_id = NULL, notify_telegram = false, updated_at = now() WHERE user_id = $1", [user.id]);
      return ok({ ok: true, message: "Telegram disconnected." });
    }
    case "delete_account": {
      await enforceRateLimit(`delete:${user.id}`, 3, 3600);
      const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      if (!(await verifyPassword(body.password, row?.password_hash ?? null))) throw badRequest("Password is incorrect.");
      await audit(user.id, "account.deleted", { type: "user", id: user.id }, { email: user.email }, ip);
      await destroySession();
      await query("DELETE FROM users WHERE id = $1", [user.id]);
      return ok({ ok: true });
    }
  }
});
