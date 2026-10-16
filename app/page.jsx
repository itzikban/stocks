import Tracker from "@/components/Tracker";
import { getSnapshot, getWatchlist } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [snapshot, watchlist] = await Promise.all([getSnapshot(), getWatchlist()]);
  return <Tracker initial={{ snapshot, watchlist }} />;
}
