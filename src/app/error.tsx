"use client";

import { Button } from "@/components/ui";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-fg-muted">An unexpected error occurred. It has been logged{error.digest ? ` (ref ${error.digest})` : ""}.</p>
      <Button className="mt-5" variant="primary" onClick={reset}>Try again</Button>
    </main>
  );
}
