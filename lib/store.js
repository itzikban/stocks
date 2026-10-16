// Storage abstraction. If a Neon Postgres URL is set state lives in the DB,
// otherwise everything falls back to data.json + the default watchlist (read-only).
// Vercel Neon integration names the variable with the project prefix
// (stocks_DATABASE_URL); plain DATABASE_URL is accepted as a fallback.
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_WATCHLIST } from "./defaults";

export const getDatabaseUrl = () =>
  process.env.stocks_DATABASE_URL || process.env.DATABASE_URL || "";
export const hasDb = () => Boolean(getDatabaseUrl());

async function sql() {
  const { neon } = await import("@neondatabase/serverless");
  return neon(getDatabaseUrl());
}

let schemaReady = false;
async function ensureSchema(q) {
  if (schemaReady) return;
  await q`CREATE TABLE IF NOT EXISTS snapshot (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  await q`CREATE TABLE IF NOT EXISTS watchlist (symbol text PRIMARY KEY, name text NOT NULL, market text NOT NULL DEFAULT 'US', company text, position int NOT NULL DEFAULT 0)`;
  schemaReady = true;
}

async function readFileSnapshot() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { generated_at: null, tickers: {} };
  }
}

export async function getSnapshot() {
  if (hasDb()) {
    try {
      const q = await sql();
      await ensureSchema(q);
      const rows = await q`SELECT data FROM snapshot WHERE id = 1`;
      if (rows.length) return rows[0].data;
    } catch (e) {
      console.error("db snapshot read failed, using data.json", e);
    }
  }
  return readFileSnapshot();
}

export async function saveSnapshot(data) {
  const q = await sql();
  await ensureSchema(q);
  await q`INSERT INTO snapshot (id, data, updated_at) VALUES (1, ${JSON.stringify(data)}::jsonb, now())
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}

export async function getWatchlist() {
  if (hasDb()) {
    try {
      const q = await sql();
      await ensureSchema(q);
      const rows = await q`SELECT symbol, name, market, company FROM watchlist ORDER BY position, symbol`;
      if (rows.length) return rows;
    } catch (e) {
      console.error("db watchlist read failed, using defaults", e);
    }
  }
  return DEFAULT_WATCHLIST;
}

export async function addToWatchlist({ symbol, name, market = "US", company = null }) {
  const q = await sql();
  await ensureSchema(q);
  // First write seeds the table with defaults so adding one stock keeps the rest.
  const existing = await q`SELECT count(*)::int AS n FROM watchlist`;
  if (existing[0].n === 0) {
    for (const [i, w] of DEFAULT_WATCHLIST.entries()) {
      await q`INSERT INTO watchlist (symbol, name, market, company, position) VALUES (${w.symbol}, ${w.name}, ${w.market}, ${w.company ?? null}, ${i}) ON CONFLICT DO NOTHING`;
    }
  }
  const pos = await q`SELECT coalesce(max(position), 0) + 1 AS p FROM watchlist`;
  await q`INSERT INTO watchlist (symbol, name, market, company, position) VALUES (${symbol}, ${name}, ${market}, ${company}, ${pos[0].p})
          ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, market = EXCLUDED.market, company = EXCLUDED.company`;
}

export async function removeFromWatchlist(symbol) {
  const q = await sql();
  await ensureSchema(q);
  const existing = await q`SELECT count(*)::int AS n FROM watchlist`;
  if (existing[0].n === 0) {
    for (const [i, w] of DEFAULT_WATCHLIST.entries()) {
      await q`INSERT INTO watchlist (symbol, name, market, company, position) VALUES (${w.symbol}, ${w.name}, ${w.market}, ${w.company ?? null}, ${i}) ON CONFLICT DO NOTHING`;
    }
  }
  await q`DELETE FROM watchlist WHERE symbol = ${symbol}`;
}
