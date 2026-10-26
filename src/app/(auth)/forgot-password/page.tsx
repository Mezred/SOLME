import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-80 animate-pulse" />}>
      <ForgotForm />
    </Suspense>
  );
}