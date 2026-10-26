import Link from "next/link";
import { Logo } from "@/components/brand";
import { Disclaimer } from "@/components/ui";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="grid-bg absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden="true" />
      <header className="relative mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Back to site
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="relative mx-auto w-full max-w-md px-4 pb-8">
        <Disclaimer className="text-center" />
      </footer>
    </div>
  );
}
