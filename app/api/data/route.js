import { getSnapshot, getWatchlist } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const [snapshot, watchlist] = await Promise.all([getSnapshot(), getWatchlist()]);
  return Response.json({ snapshot, watchlist }, { headers: { "Cache-Control": "no-store" } });
}
