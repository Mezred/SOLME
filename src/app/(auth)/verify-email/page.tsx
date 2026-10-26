import type { Metadata } from "next";
import { ButtonLink, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { status } = await searchParams;
  const success = status === "success";
  return (
    <div className="card p-6 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">{success ? "Email verified" : "Verification link problem"}</h1>
      <div className="mt-5">
        {success ? (
          <Notice tone="info">Thanks — your email address is confirmed. Email alerts and billing are now available.</Notice>
        ) : (
          <Notice tone="down">This verification link is invalid, already used or expired. Sign in and request a new one from Account Settings.</Notice>
        )}
      </div>
      <ButtonLink href="/app" variant="primary" size="lg" className="mt-6 w-full">
        Go to dashboard
      </ButtonLink>
    </div>
  );
}
