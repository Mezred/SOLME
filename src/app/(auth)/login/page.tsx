import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Log in" };

export default function Page() {
  return (
    <Suspense fallback={<div className="card h-80 animate-pulse" />}>
      <LoginForm />
    </Suspense>
  );
}