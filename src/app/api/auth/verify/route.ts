import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { markVerified } from "@/lib/auth/accounts";
import { consumeAuthToken } from "@/lib/auth/tokens";
import { env } from "@/lib/env";

/** Email verification link target. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const userId = token.length >= 20 && token.length <= 200 ? await consumeAuthToken(token, "verify_email") : null;
  if (!userId) return NextResponse.redirect(new URL("/verify-email?status=invalid", env.appUrl));
  await markVerified(userId);
  await audit(userId, "auth.email_verified", { type: "user", id: userId });
  return NextResponse.redirect(new URL("/verify-email?status=success", env.appUrl));
}
