import { redirect } from "next/navigation";

/** The Screener was folded into Early Coins; old links and bookmarks land there. */
export default function ScreenerRedirect(): never {
  redirect("/app");
}
