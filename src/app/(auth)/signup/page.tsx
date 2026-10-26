import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-80 animate-pulse" />}>
      <SignupForm />
    </Suspense>
  );
}