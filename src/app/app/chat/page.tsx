import type { Metadata } from "next";
import { AiChat } from "@/components/app/ai-chat";
import { PageHeader } from "@/components/ui";
import { aiUsageToday } from "@/lib/ai/chat";
import { requirePageUser } from "@/lib/auth/guard";
import { getEntitlements } from "@/lib/billing/entitlements";
import { integrations } from "@/lib/env";

export const metadata: Metadata = { title: "AI Chat" };

export default async function ChatPage({ searchParams }: PageProps<"/app/chat">) {
  const user = await requirePageUser("/app/chat");
  const sp = await searchParams;
  const [ent, used] = await Promise.all([getEntitlements(user.id), aiUsageToday(user.id)]);
  return (
    <>
      <PageHeader
        title="AI Chat"
        description="Ask about tokens, signals, security warnings, wallets and market conditions. The assistant retrieves NEXALPHA data through tools, cites timestamps and says when data is missing. It does not predict prices or give buy/sell advice."
      />
      <AiChat configured={integrations.ai} used={used} limit={ent.features.ai_daily_requests} initialPrompt={typeof sp.q === "string" ? sp.q.slice(0, 500) : undefined} />
    </>
  );
}
