import type { Database } from "./index";

export interface CopyResult {
  table: string;
  rows: number;
}

const BATCH = 2_000;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Public tables, parents before children (foreign keys), without the migration ledger. */
async function tablesInOrder(db: Database): Promise<string[]> {
  const tables = (await db.query<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename")).map((t) => t.name);
  const deps = await db.query<{ child: string; parent: string }>(
    `SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name <> ccu.table_name`,
  );
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (t: string) => {
    if (ordered.includes(t) || visiting.has(t)) return;
    visiting.add(t);
    for (const d of deps.filter((x) => x.child === t)) if (tables.includes(d.parent)) visit(d.parent);
    visiting.delete(t);
    ordered.push(t);
  };
  tables.forEach(visit);
  return ordered;
}

/**
 * Copies every row of every public table from `src` to `dst` (both already migrated to the same schema): the way off
 * the embedded PGlite database onto Postgres. The target's tables are emptied first, so seeded defaults are replaced by
 * the source's (plans, settings, admin edits); it refuses a target that already has users unless `force` is set.
 * bigserial counters are moved past the copied ids. Rows go through JSON, so both drivers work unchanged.
 */
export async function copyDatabase(src: Database, dst: Database, opts: { force?: boolean; log?: (line: string) => void } = {}): Promise<CopyResult[]> {
  const log = opts.log ?? (() => {});
  const [srcMigs, dstMigs] = await Promise.all([src, dst].map((d) => d.query<{ n: number }>("SELECT count(*)::int AS n FROM schema_migrations")));
  if (srcMigs[0].n !== dstMigs[0].n) throw new Error(`Schemas differ (${srcMigs[0].n} vs ${dstMigs[0].n} migrations): run the same version against both first.`);
  const [{ n: users }] = await dst.query<{ n: number }>("SELECT count(*)::int AS n FROM users");
  if (users > 0 && !opts.force) throw new Error(`The target already has ${users} user(s). Use --force to replace its data.`);

  const tables = await tablesInOrder(src);
  await dst.exec(`TRUNCATE ${tables.map(q).join(", ")} CASCADE`);
  const results: CopyResult[] = [];
  for (const table of tables) {
    let copied = 0;
    for (let offset = 0; ; offset += BATCH) {
      const rows = await src.query<{ j: string }>(`SELECT row_to_json(t)::text AS j FROM ${q(table)} t ORDER BY 1 LIMIT ${BATCH} OFFSET ${offset}`);
      if (!rows.length) break;
      await dst.query(`INSERT INTO ${q(table)} SELECT * FROM json_populate_recordset(NULL::${q(table)}, $1::json)`, [`[${rows.map((r) => r.j).join(",")}]`]);
      copied += rows.length;
      if (rows.length < BATCH) break;
    }
    results.push({ table, rows: copied });
    log(`${table}: ${copied}`);
  }

  // bigserial ids: continue after the copied rows.
  const serials = await dst.query<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'",
  );
  for (const s of serials) {
    await dst.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT max(${q(s.column_name)}) FROM ${q(s.table_name)}), 0) + 1, false)`,
      [s.table_name, s.column_name],
    );
  }
  return results;
}
