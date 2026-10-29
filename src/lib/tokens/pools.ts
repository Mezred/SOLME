/**
 * Addresses that hold pool reserves on behalf of an AMM or launchpad program. They look like ordinary wallets (no
 * program owns the account itself) but nobody can trade from them: they must never count as holders or be used as a
 * wallet in a simulated sell.
 */
export const POOL_AUTHORITIES = new Set([
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1", // Raydium AMM v4
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL", // Raydium CPMM
  "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh", // Raydium LaunchLab (LetsBonk)
]);
