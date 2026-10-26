import { z } from "zod";
import { CHAIN_IDS } from "@/lib/chains";

const positive = z.number().finite().positive();
const nonneg = z.number().finite().min(0);

export const tradeSchema = z.object({
  side: z.enum(["buy", "sell"]),
  quantity: positive.max(1e18),
  price: nonneg.max(1e12),
  fee: nonneg.max(1e12).default(0),
  executedAt: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 5 * 60_000, "Trade time cannot be in the future"),
  note: z.string().max(500).nullable().optional(),
});

export const takeProfitsSchema = z.array(z.object({ price: positive, pct: z.number().min(0).max(100).optional() })).max(6);

export const positionCreateSchema = z
  .object({
    portfolioId: z.string().uuid(),
    tokenId: z.string().uuid().optional(),
    chain: z.enum(CHAIN_IDS as [string, ...string[]]).optional(),
    tokenAddress: z.string().trim().max(64).optional(),
    tokenSymbol: z.string().trim().min(1).max(32).optional(),
    entry: tradeSchema.omit({ side: true }),
    stopLoss: positive.nullable().optional(),
    takeProfits: takeProfitsSchema.default([]),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.tokenId || (v.chain && v.tokenAddress && v.tokenSymbol), "Pick a tracked token or enter chain, address and symbol");

export const positionPatchSchema = z.object({
  stopLoss: positive.nullable().optional(),
  takeProfits: takeProfitsSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});
