export function fmtNum(v, digits) {
  return Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtPrice(v, sym) {
  if (v === null || v === undefined) return "—";
  let suffix = sym === "NXSN.TA" ? " ₪" : "$";
  if (sym === "^TA125.TA") suffix = "";
  return fmtNum(v, 2) + suffix;
}
export const fmtUSD = (v) => (v === null || v === undefined ? "—" : "$" + fmtNum(v, 2));
export function fmtPct(v) {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + Number(v).toFixed(2) + "%";
}
export function fmtGenerated(iso) {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const get = (t) => (parts.find((x) => x.type === t) || {}).value || "";
  return `${get("day")}.${get("month")} , ${get("hour")}:${get("minute")}`;
}
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
export function monthChange(h) {
  if (!h || h.length < 2) return null;
  const ref = h[Math.max(0, h.length - 22)][1];
  const last = h[h.length - 1][1];
  return ref ? ((last - ref) / ref) * 100 : null;
}
export const ma20 = (h) => (h && h.length ? mean(h.slice(-20).map((p) => p[1])) : null);
export const ma20Series = (h) => h.map((_, i) => mean(h.slice(Math.max(0, i - 19), i + 1).map((p) => p[1])));
export const pctClass = (v) => (v === null || v === undefined ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");
export const arrowOf = (v) => (v > 0 ? "▲ " : v < 0 ? "▼ " : "");

export function classifySignal(sig, t) {
  let up = null, sub = "איתות";
  if (sig.includes("חצתה")) { up = sig.includes("מעלה"); sub = "חציית ממוצע"; }
  else if (sig.includes("מגמת")) { up = sig.includes("עלייה"); const m = sig.match(/(\d+)\s*ימים/); sub = "רצף " + (m ? m[1] : "3") + " ימים"; }
  else if (sig.includes("תזוזה חדה")) {
    up = t.day_pct !== null && t.day_pct !== undefined ? t.day_pct > 0 : sig.includes("עלתה");
    sub = up ? "זינוק יומי" : "נפילה יומית";
  }
  return { up, sub };
}
