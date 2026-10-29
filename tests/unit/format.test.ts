import { describe, expect, it } from "vitest";
import { createTestDb } from "@/lib/db";
import { MIGRATIONS } from "@/lib/db/migrations.generated";
import { readableLabel } from "@/lib/format";

const MINT = "ChMxfMQfLcxmMcXR2Prc2P8nqpRLJUYjxZ8sRbeKqpump";

describe("readableLabel", () => {
  it("replaces labels with no letters or digits by the short contract address", () => {
    expect(readableLabel("███", MINT)).toBe("ChMx…pump");
    expect(readableLabel("???", MINT)).toBe("ChMx…pump");
    expect(readableLabel("  ", MINT)).toBe("ChMx…pump");
    expect(readableLabel(null, MINT)).toBe("ChMx…pump");
  });

  it("keeps readable labels in any script, including emoji mixed with letters", () => {
    for (const s of ["BONK", "宇树科技", "밈", "Anh Yêu Em", "🍔VIK", "$WIF", "404"]) expect(readableLabel(s, MINT)).toBe(s);
  });
});

describe("0010_readable_labels migration", () => {
  it("rewrites block-character labels to the short address and leaves other scripts alone", async () => {
    const db = await createTestDb();
    const sql = MIGRATIONS.find((m) => m.name === "0010_readable_labels")!.sql;
    await db.query(
      `INSERT INTO token_assets (chain, address, symbol, name) VALUES
         ('solana', $1, '███', '███'), ('solana', 'Kor1111111111111111111111111111111111111pump', '밈', '밈'),
         ('solana', 'Chn1111111111111111111111111111111111111pump', '宇树科技', '宇树科技'), ('solana', 'Qst1111111111111111111111111111111111111234', '???', 'Real Name')`,
      [MINT],
    );
    await db.exec(sql); // re-run on the rows above (it already ran once during createTestDb)
    const rows = await db.query<{ address: string; symbol: string; name: string; original: string | null }>(
      "SELECT address, symbol, name, metadata->>'original_symbol' AS original FROM token_assets ORDER BY address",
    );
    const by = Object.fromEntries(rows.map((r) => [r.address, r]));
    expect(by[MINT]).toMatchObject({ symbol: "ChMx…pump", name: "ChMx…pump", original: "███" });
    expect(by["Kor1111111111111111111111111111111111111pump"]).toMatchObject({ symbol: "밈", name: "밈" });
    expect(by["Chn1111111111111111111111111111111111111pump"]).toMatchObject({ symbol: "宇树科技" });
    expect(by["Qst1111111111111111111111111111111111111234"]).toMatchObject({ symbol: "Qst1…1234", name: "Real Name" });
    await db.close();
  });
});

describe("readableLabel strips padding glyphs", () => {
  it("removes block, box and invisible characters but keeps the real name", () => {
    const mint = "9MGMMbtNPaVKjp2iwydnTM9rZTnGnB77xgUMQnASbJjP";
    expect(readableLabel("█████WIF", mint)).toBe("WIF");
    expect(readableLabel("▓▓ PEPE ■", mint)).toBe("PEPE");
    expect(readableLabel("BON\u200BK", mint)).toBe("BONK");
    expect(readableLabel("███", mint)).toBe("9MGM…bJjP");
    expect(readableLabel("宇树科技", mint)).toBe("宇树科技");
  });
});

describe("0028_strip_block_labels migration", () => {
  it("cleans names already stored, keeping the original in metadata", async () => {
    const db = await createTestDb();
    await db.query("INSERT INTO token_assets (chain, address, symbol, name) VALUES ('solana', 'Wif11111111111111111111111111111111111111111', '█████WIF', '█████ dogwifhat'), ('solana', 'Blk11111111111111111111111111111111111111111', '████', '████')");
    await db.exec(MIGRATIONS.find((m) => m.name === "0028_strip_block_labels")!.sql);
    const rows = await db.query<{ symbol: string; name: string; original: string }>("SELECT symbol, name, metadata->>'original_symbol' AS original FROM token_assets ORDER BY address");
    expect(rows).toEqual([
      { symbol: "Blk1…1111", name: "Blk1…1111", original: "████" },
      { symbol: "WIF", name: "dogwifhat", original: "█████WIF" },
    ]);
    await db.close();
  });
});
