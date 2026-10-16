import { timingSafeEqual } from "node:crypto";

// Returns null if authorized, otherwise a Response to send back.
export function checkAuth(request) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return Response.json({ error: "INGEST_SECRET not configured" }, { status: 503 });
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
