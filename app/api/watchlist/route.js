import { checkAuth } from "@/lib/auth";
import { addToWatchlist, getWatchlist, hasDb, removeFromWatchlist } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  return Response.json({ watchlist: await getWatchlist(), db: hasDb() });
}

// POST body: { action: "add", symbol, name, market?: "US"|"IL", company? } or { action: "remove", symbol }
export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  if (!hasDb()) return Response.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let b;
  try { b = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  const symbol = typeof b.symbol === "string" ? b.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9^.\-]{1,15}$/.test(symbol)) return Response.json({ error: "bad symbol" }, { status: 400 });
  if (b.action === "add") {
    const market = b.market === "IL" ? "IL" : "US";
    await addToWatchlist({ symbol, name: String(b.name || symbol).slice(0, 60), market, company: b.company ? String(b.company).slice(0, 80) : null });
  } else if (b.action === "remove") {
    await removeFromWatchlist(symbol);
  } else {
    return Response.json({ error: "action must be add or remove" }, { status: 400 });
  }
  return Response.json({ ok: true, watchlist: await getWatchlist() });
}
