import { cookies } from "next/headers";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";

export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  // Cookie presence only toggles nav buttons; nothing protected is rendered here.
  const signedIn = (await cookies()).has("nx_session");
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav signedIn={signedIn} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
