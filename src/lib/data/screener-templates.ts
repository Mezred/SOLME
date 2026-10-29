import { withUser } from "@/lib/db";
import { tokenFilterSchema } from "./tokens";

/** Query parameters a template may store: the Screener's filters and sort, never paging. */
export const TEMPLATE_KEYS = Object.keys(tokenFilterSchema.shape).filter((k) => k !== "page" && k !== "pageSize");
export const MAX_TEMPLATES = 30;

export interface ScreenerTemplate {
  id: string;
  name: string;
  params: Record<string, string>;
}

export async function listTemplates(userId: string): Promise<ScreenerTemplate[]> {
  return withUser(userId, (tx) => tx.query<ScreenerTemplate>("SELECT id, name, params FROM screener_templates ORDER BY name"));
}

/** Keeps only known, non-empty filter values. */
export function cleanParams(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => TEMPLATE_KEYS.includes(k) && v.trim() !== "").map(([k, v]) => [k, v.trim()]));
}
