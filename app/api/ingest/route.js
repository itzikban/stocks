import { checkAuth } from "@/lib/auth";
import { hasDb, saveNews, saveSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  // Optional news: { SYM: [{date:"YYYY-MM-DD", title, url, source, vendor, published_at}] }
  let news = null;
  if (body.news !== undefined) {
    if (typeof body.news !== "object" || Array.isArray(body.news) || body.news === null) {
      return Response.json({ error: "body.news must be an object" }, { status: 400 });
    }
    news = {};
    let total = 0;
    for (const [sym, items] of Object.entries(body.news)) {
      if (!/^[A-Z0-9^.\-]{1,15}$/.test(sym) || !Array.isArray(items)) continue;
      news[sym] = [];
      for (const it of items) {
        if (!it || typeof it.title !== "string" || typeof it.url !== "string" || typeof it.vendor !== "string") continue;
        if (!/^https?:\/\//.test(it.url) || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || "")) continue;
        if (++total > 3000) break;
        news[sym].push({
          date: it.date, url: it.url.slice(0, 2000), title: it.title.slice(0, 400),
          source: typeof it.source === "string" ? it.source.slice(0, 120) : null,
          vendor: it.vendor.slice(0, 60),
          categories: Array.isArray(it.categories) ? it.categories.slice(0, 4).filter((c) => c && typeof c.label === "string").map((c) => ({ key: String(c.key || "").slice(0, 20), label: c.label.slice(0, 30) })) : [],
          published_at: it.published_at && !Number.isNaN(Date.parse(it.published_at)) ? it.published_at : null,
        });
      }
    }
  }
  await saveSnapshot({ generated_at: body.generated_at || new Date().toISOString(), tickers: body.tickers });
  const newsSaved = news ? await saveNews(news) : 0;
  return Response.json({ ok: true, tickers: Object.keys(body.tickers).length, news: newsSaved });
}
