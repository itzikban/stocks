import { checkAuth } from "@/lib/auth";
import { hasDb, saveSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// POST /api/ingest   Authorization: Bearer <INGEST_SECRET>
// Body: same shape as data.json: { generated_at, tickers: { SYM: { price, day_pct, history, signals, ... } } }
export async function POST(request) {
  const denied = checkAuth(request);
  if (denied) return denied;
  if (!hasDb()) return Response.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
  if (!body || typeof body.tickers !== "object" || Array.isArray(body.tickers)) {
    return Response.json({ error: "body.tickers object required" }, { status: 400 });
  }
  for (const [sym, t] of Object.entries(body.tickers)) {
    if (t && t.history && !Array.isArray(t.history)) {
      return Response.json({ error: `bad history for ${sym}` }, { status: 400 });
    }
  }
  await saveSnapshot({ generated_at: body.generated_at || new Date().toISOString(), tickers: body.tickers });
  return Response.json({ ok: true, tickers: Object.keys(body.tickers).length });
}
