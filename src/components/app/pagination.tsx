import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { hrefWith, type SearchParamsRecord } from "./url";

export function Pagination({ base, params, page, pageSize, total }: { base: string; params: SearchParamsRecord; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="px-4 py-3 text-xs text-fg-faint">{total} result{total === 1 ? "" : "s"}</p>;
  return (
    <nav className="flex items-center justify-between gap-3 px-4 py-3" aria-label="Pagination">
      <p className="text-xs text-fg-faint">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link className={buttonClass("secondary", "sm")} href={hrefWith(base, params, { page: page - 1 })}>
            ← Prev
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "opacity-40")}>← Prev</span>
        )}
        <span className="num px-2 text-xs text-fg-muted">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className={buttonClass("secondary", "sm")} href={hrefWith(base, params, { page: page + 1 })}>
            Next →
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "opacity-40")}>Next →</span>
        )}
      </div>
    </nav>
  );
}

export function SortHeader({ base, params, field, label, align = "left" }: { base: string; params: SearchParamsRecord; field: string; label: string; align?: "left" | "right" }) {
  const active = params.sort === field;
  const dir = active && params.dir !== "asc" ? "asc" : "desc";
  return (
    <th className={align === "right" ? "text-right" : undefined} aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={hrefWith(base, params, { sort: field, dir, page: undefined })} className={active ? "text-fg" : "hover:text-fg-muted"}>
        {label}
        {active ? (params.dir === "asc" ? " ↑" : " ↓") : ""}
      </Link>
    </th>
  );
}
