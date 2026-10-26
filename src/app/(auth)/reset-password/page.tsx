import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-80 animate-pulse" />}>
      <ResetForm />
    </Suspense>
  );
}