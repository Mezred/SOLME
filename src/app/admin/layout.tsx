import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { AdminNav } from "@/components/admin/admin-nav";
import { Badge } from "@/components/ui";
import { requirePageUser } from "@/lib/auth/guard";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · NEXALPHA" }, robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requirePageUser("/admin");
  if (user.role !== "admin" && user.role !== "support") redirect("/app");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink-950/90 px-4 backdrop-blur">
        <Logo href="/admin" />
        <Badge tone="warn">{user.role === "admin" ? "Administrator" : "Support"}</Badge>
        <Link href="/app" className="ml-auto text-sm text-fg-muted hover:text-fg">← Back to terminal</Link>
      </header>
      <div className="flex">
        <AdminNav role={user.role} />
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
