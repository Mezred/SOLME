import { normalizeAddress, type ChainId } from "@/lib/chains";
import { queryOne, withUser } from "@/lib/db";
import { api, badRequest, notFound, ok, parseBody, requireUser } from "@/lib/http";
import { positionCreateSchema } from "@/lib/portfolio/schemas";

/** Records a manual position with its opening buy. Nothing is verified on-chain; source = 'manual'. */
export const POST = api(async (req) => {
  const user = await requireUser();
  const b = await parseBody(req, positionCreateSchema);
  let chain: string;
  let address: string;
  let symbol: string;
  let tokenId: string | null = null;
  if (b.tokenId) {
    const t = await queryOne<{ chain: string; address: string; symbol: string }>("SELECT chain, address, symbol FROM token_assets WHERE id = $1", [b.tokenId]);
    if (!t) throw notFound("Token not found");
    ({ chain, address, symbol } = t);
    tokenId = b.tokenId;
  } else {
    const norm = normalizeAddress(b.chain as ChainId, b.tokenAddress!);
    if (!norm) throw badRequest("Contract address is not valid for this chain");
    chain = b.chain!;
    address = norm;
    symbol = b.tokenSymbol!.toUpperCase();
    const known = await queryOne<{ id: string }>("SELECT id FROM token_assets WHERE chain = $1 AND address = $2", [chain, norm]);
    tokenId = known?.id ?? null;
  }
  if (b.stopLoss && b.stopLoss >= b.entry.price && b.entry.price > 0) throw badRequest("Stop loss must be below the entry price for a long position");
  const id = await withUser(user.id, async (tx) => {
    const [pf] = await tx.query("SELECT id FROM portfolios WHERE id = $1", [b.portfolioId]);
    if (!pf) throw notFound("Portfolio not found");
    const [pos] = await tx.query<{ id: string }>(
      `INSERT INTO positions (portfolio_id, user_id, token_id, chain, token_address, token_symbol, stop_loss, take_profits, notes, opened_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [b.portfolioId, user.id, tokenId, chain, address, symbol, b.stopLoss ?? null, JSON.stringify(b.takeProfits), b.notes ?? null, b.entry.executedAt],
    );
    await tx.query(
      "INSERT INTO trades (position_id, user_id, side, quantity, price, fee, executed_at, note) VALUES ($1,$2,'buy',$3,$4,$5,$6,$7)",
      [pos.id, user.id, b.entry.quantity, b.entry.price, b.entry.fee, b.entry.executedAt, b.entry.note ?? null],
    );
    return pos.id;
  });
  return ok({ id }, { status: 201 });
});
