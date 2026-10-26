import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "./session";

/** For Server Components/layouts: the authoritative auth check (proxy.ts is only optimistic). */
export async function requirePageUser(next = "/app"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requirePageAdmin(): Promise<SessionUser> {
  const user = await requirePageUser("/admin");
  if (user.role !== "admin") redirect("/app");
  return user;
}
