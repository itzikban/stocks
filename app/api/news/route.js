import { getNews } from "@/lib/store";

export const dynamic = "force-dynamic";

// GET /api/news?symbol=TSLA  -> news items of the last 60 days, newest first (public, read only).
export async function GET(request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
  if (!/^[A-Z0-9^.\-]{1,15}$/.test(symbol)) return Response.json({ error: "bad symbol" }, { status: 400 });
  const news = await getNews(symbol);
  return Response.json({ symbol, news }, { headers: { "Cache-Control": "no-store" } });
}
