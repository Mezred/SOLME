"use client";

import { Button, ErrorState } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <ErrorState
        title="This view failed to load"
        body={<>A data provider or the database may be temporarily unavailable. Your data is safe.{error.digest && <span className="num block pt-1 text-xs text-fg-faint">ref {error.digest}</span>}</>}
      />
      <div className="mt-4 text-center"><Button variant="primary" onClick={reset}>Retry</Button></div>
    </div>
  );
}
