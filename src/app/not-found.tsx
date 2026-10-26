import { LogoMark } from "@/components/brand";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <LogoMark size={40} />
      <p className="num mt-6 text-sm text-up">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Nothing at this address</h1>
      <p className="mt-2 max-w-md text-fg-muted">The page or token you were looking for doesn&apos;t exist or is no longer tracked.</p>
      <div className="mt-6 flex gap-3">
        <ButtonLink href="/" variant="secondary">Home</ButtonLink>
        <ButtonLink href="/app" variant="primary">Open terminal</ButtonLink>
      </div>
    </main>
  );
}
