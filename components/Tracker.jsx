"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Chart from "./Chart";
import { DEFAULT_WATCHLIST } from "@/lib/defaults";
import { arrowOf, classifySignal, fmtGenerated, fmtNum, fmtPct, fmtPrice, fmtUSD, ma20, ma20Series, monthChange, pctClass } from "@/lib/format";

function Badges({ t }) {
  const sigs = t.signals || [];
  return (
    <>
      {sigs.map((s) => <span key={s} className="badge">{s}</span>)}
      {t.error && <span className="badge warn">שגיאת משיכה</span>}
      {t.stale && <span className="badge warn">נתונים ישנים: המשיכה האחרונה נכשלה</span>}
      {!sigs.length && !t.error && <span className="empty">אין איתותים חדשים</span>}
    </>
  );
}

function fmtDay(d) { const [y, m, dd] = d.split("-"); return `${dd}.${m}.${y}`; }
function fmtVol(v) {
  if (v === null || v === undefined) return "—";
  if (v >= 1e9) return fmtNum(v / 1e9, 2) + "B";
  if (v >= 1e6) return fmtNum(v / 1e6, 2) + "M";
  if (v >= 1e3) return fmtNum(v / 1e3, 1) + "K";
  return String(v);
}

// Detail panel for the pinned day: close, change, volume, MA20 and the news since the previous close.
function DayPanel({ t, sym, date, news, newsLoaded, onClose }) {
  const h = t.history || [];
  const i = h.findIndex((p) => p[0] === date);
  if (i < 0) return null;
  const close = h[i][1];
  const prev = i > 0 ? h[i - 1][1] : null;
  const pct = prev ? ((close - prev) / prev) * 100 : null;
  const ma = ma20Series(h)[i];
  const vol = (t.volumes || []).find((v) => v[0] === date);
  const prevDate = i > 0 ? h[i - 1][0] : null;
  const items = news.filter((n) => n.date <= date && (!prevDate || n.date > prevDate));
  return (
    <div className="day-panel">
      <div className="dp-head">
        <strong>{fmtDay(date)}</strong>
        <button type="button" className="dp-close" onClick={onClose} aria-label="סגור">✕</button>
      </div>
      <div className="dp-stats">
        <div><div className="lbl">סגירה</div><div className="val">{fmtPrice(close, sym)}</div></div>
        <div><div className="lbl">שינוי יומי</div><div className={"val " + pctClass(pct)}>{fmtPct(pct === null ? null : Math.round(pct * 100) / 100)}</div></div>
        <div><div className="lbl">מחזור</div><div className="val">{fmtVol(vol && vol[1])}</div></div>
        <div><div className="lbl">MA20</div><div className="val">{fmtPrice(ma, sym)}</div></div>
      </div>
      <div className="dp-news-title">חדשות חשובות מאז הסגירה הקודמת ({items.length})</div>
      {!newsLoaded && <div className="empty">טוען חדשות…</div>}
      {newsLoaded && !items.length && <div className="empty">אין חדשות חשובות שמורות לתאריך הזה.</div>}
      <ul className="dp-news">
        {items.map((n) => (
          <li key={n.url}>
            <a href={n.url} target="_blank" rel="noopener noreferrer" dir="auto">{n.title_he || n.title}</a>
            {n.title_he && <div className="dp-orig" dir="ltr">{n.title}</div>}
            <div className="dp-tags">{(n.categories || []).map((c) => <span key={c.key} className="dp-tag">{c.label}</span>)}</div>
            <div className="dp-src">{n.source && n.source !== n.vendor ? n.source + " · " : ""}<span>{n.vendor}</span> · {fmtDay(n.date)}</div>
          </li>
        ))}
      </ul>
      <div className="dp-note">התגיות הן סיווג אוטומטי לפי מילות מפתח בכותרת, לא הערכה של השפעה על המחיר. הכותרות והקישורים מהמקור.</div>
    </div>
  );
}

export default function Tracker({ initial }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState("us");
  const [busy, setBusy] = useState(false);
  const watchlist = data.watchlist && data.watchlist.length ? data.watchlist : DEFAULT_WATCHLIST;
  const tickers = data.snapshot.tickers || {};
  const us = watchlist.filter((w) => w.market !== "IL");
  const il = watchlist.filter((w) => w.market === "IL");
  const [featured, setFeatured] = useState(us[0]?.symbol);
  const [pinned, setPinned] = useState(null);
  const [news, setNews] = useState([]);
  const [newsFor, setNewsFor] = useState(null);
  useEffect(() => { setPinned(null); }, [featured]);
  useEffect(() => {
    if (!featured) return;
    let live = true;
    fetch("/api/news?symbol=" + encodeURIComponent(featured))
      .then((r) => (r.ok ? r.json() : { news: [] }))
      .then((d) => { if (live) { setNews(d.news || []); setNewsFor(featured); } })
      .catch(() => { if (live) { setNews([]); setNewsFor(featured); } });
    return () => { live = false; };
  }, [featured, data.snapshot.generated_at]);
  const newsDates = useMemo(() => Array.from(new Set(news.map((n) => n.date))), [news]);
  const meta = (sym) => watchlist.find((w) => w.symbol === sym) || {};

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/data", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {} finally { setBusy(false); }
  }, []);
  useEffect(() => { const id = setInterval(refresh, 60000); return () => clearInterval(id); }, [refresh]);

  const events = (list) => list.flatMap((w) => (tickers[w.symbol]?.signals || []).map((sig) => ({ sym: w.symbol, sig, t: tickers[w.symbol] })));
  const usEvents = events(us);
  const ilEvents = events(il);
  const ft = tickers[featured];
  const missing = us.filter((w) => !tickers[w.symbol]).map((w) => w.symbol);

  return (
    <>
      <header className="topbar">
        <button className="refresh-btn" type="button" disabled={busy} onClick={refresh}><span className="ricon">↻</span>רענון</button>
        <div className="update"><span className="lbl">עדכון שוק</span><strong>{fmtGenerated(data.snapshot.generated_at)}</strong></div>
      </header>
      <nav className="tabs" aria-label="לשוניות">
        <button className={tab === "us" ? "active" : ""} type="button" onClick={() => setTab("us")}>ארה״ב · תזת אנתרופיק</button>
        <button className={tab === "il" ? "active" : ""} type="button" onClick={() => setTab("il")}>ישראל · ערב מלחמה <span className="tab-badge">{ilEvents.length} אותות</span></button>
      </nav>
      <main>
        {tab === "us" && <section>
          <div className="alert-panel">
            <div className="alert-head">
              <div><div className="alert-sub">אותות מגמה</div><h2>{usEvents.length} אירועים פעילים</h2></div>
              <div className="alert-legend">MA20 · תזוזה חדה 3% · רצף 3 ימים</div>
            </div>
            <div className="alert-list">
              {usEvents.map((ev, i) => {
                const c = classifySignal(ev.sig, ev.t);
                return (
                  <div className="event" key={i}>
                    <span className="ev-arrow">{c.up === null ? "•" : c.up ? "▲" : "▼"}</span>
                    <div><div className="ev-top"><strong>{ev.sym}</strong><span>{ev.sig}</span></div><div className="ev-sub">{c.sub}</div></div>
                  </div>
                );
              })}
            </div>
            {!usEvents.length && <p className="alert-empty">אין איתותים פעילים</p>}
          </div>
          <div className="us-layout">
            <aside className="watchlist">
              <div className="wl-head"><h3>רשימת המעקב</h3><span>{us.length} מניות</span></div>
              <div>
                {us.map((w) => {
                  const t = tickers[w.symbol];
                  if (!t) return null;
                  const has = (t.signals || []).length > 0;
                  return (
                    <button key={w.symbol} type="button" className={"wl-row" + (w.symbol === featured ? " selected" : "")} onClick={() => setFeatured(w.symbol)}>
                      <span><span className="wl-name">{t.hebrew_name || w.name}</span><br /><span className="wl-sym">{w.symbol}</span></span>
                      <span><span className="wl-price">{fmtUSD(t.price)}</span><br /><span className={"wl-pct " + pctClass(t.day_pct)}>{arrowOf(t.day_pct)}{fmtPct(t.day_pct)} היום</span></span>
                      <span className={"wl-status" + (has ? " has" : "")}>{has ? <><span className="dot"></span>התראות</> : "ללא אות"}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
            <section className="featured">
              {!ft ? <p className="empty">אין נתונים למניה זו.</p> : (
                <>
                  <div className="feat-head">
                    <div>
                      <span className="feat-sym">{featured}</span>
                      <div className="feat-name">{ft.hebrew_name || meta(featured).name || featured}</div>
                      {meta(featured).company && <div className="feat-company" dir="ltr" style={{ textAlign: "right" }}>{meta(featured).company}</div>}
                    </div>
                    <div><div className="feat-price">{fmtUSD(ft.price)}</div><div className={"feat-day " + pctClass(ft.day_pct)}>{arrowOf(ft.day_pct)}{fmtPct(ft.day_pct)} היום</div></div>
                  </div>
                  <div className="feat-stats">
                    <div><div className="lbl">חודש</div><div className={"val " + pctClass(monthChange(ft.history))}>{fmtPct(monthChange(ft.history))}</div></div>
                    <div><div className="lbl">ממוצע 20</div><div className="val">{fmtUSD(ma20(ft.history))}</div></div>
                  </div>
                  <Chart className="feat-chart" history={ft.history} sym={featured} full ma onPick={setPinned} pinned={pinned} newsDates={newsDates} />
                  <div className="chart-hint">לחיצה או נגיעה בגרף מצמידה את פרטי היום וחדשות</div>
                  <div className="chart-legend"><span><i></i>מחיר סגירה</span><span><i className="d"></i>ממוצע 20 יום</span></div>
                  <div className="feat-badges"><Badges t={ft} /></div>
                  {pinned && <DayPanel t={ft} sym={featured} date={pinned} news={news} newsLoaded={newsFor === featured} onClose={() => setPinned(null)} />}
                </>
              )}
            </section>
          </div>
          {missing.length > 0 && <p className="note">חסרים בקובץ הנתונים: {missing.join(", ")}</p>}
        </section>}

        {tab === "il" && <section>
          <p className="note">כרטיסים חיים (אלביט, מדד ת״א 125, נקסט ויז׳ן) מוצגים רק אם הם קיימים בקובץ הנתונים. שאר החברות בטבלאות למטה מופיעות כנתונים סטטיים מאומתים בלבד — ללא משיכה חיה.</p>
          <div className="il-grid">
            {il.map((w) => {
              const t = tickers[w.symbol];
              if (!t) return null;
              return (
                <article className="card" key={w.symbol}>
                  <h3>{t.hebrew_name || w.name}</h3><div className="sym">{w.symbol}</div>
                  <div className="price">{fmtPrice(t.price, w.symbol)}</div>
                  <div className={"chg " + pctClass(t.day_pct)}>{arrowOf(t.day_pct)}{fmtPct(t.day_pct)} היום</div>
                  <Chart className="spark-chart" history={t.history} sym={w.symbol} />
                  <div className="badges"><Badges t={t} /></div>
                </article>
              );
            })}
          </div>
          <Baseline />
        </section>}
      </main>
    </>
  );
}

function Baseline() {
  const rows = [["אלביט", "431.48", "741.61", "+71.9%"], ["נקסט ויז׳ן", "107.0", "187.7", "+75.4%"], ["פניקס", "76.2", "182.5", "+139.6%"], ["מגדל", "7.40", "20.13", "+172.1%"], ["בית שמש", "445.7", "800.5", "+79.6%"], ["מדד ת״א 125", "2,705", "4,109", "+51.9%"], ["דולר / שקל", "3.5566", "3.091", "שקל +13.1%"]];
  const war = [["פניקס", "+23.98%"], ["דיסקונט", "+17.41%"], ["מזרחי", "+13.32%"], ["בית שמש", "+12.39%"], ["רציו", "+11.72%"], ["הפועלים", "+10.43%"], ["מגדל", "+10.31%"], ["לאומי", "+8.96%"]];
  return (
    <>
      <h2>טבלת בסיס מאומתת — 16.10.2026</h2>
      <table>
        <thead><tr><th>נכס</th><th>מ־</th><th>ל־</th><th>שינוי</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="num">{r[1]}</td><td className="num">{r[2]}</td><td className="num">{r[3]}</td></tr>)}</tbody>
      </table>
      <h2>חלון המלחמה: 13 עד 24 ביוני 2025</h2>
      <table>
        <thead><tr><th>חברה</th><th>שינוי</th></tr></thead>
        <tbody>{war.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="num">{r[1]}</td></tr>)}</tbody>
      </table>
      <h2>תרחישים</h2>
      <div className="scenario"><h3>תרחיש א׳ — מלחמה קצרה, האיום נתפס כמוסר</h3><p>הפיננסים עולים, הביטחוניות מזנקות ואז דועכות, פחות מרווח לעלייה נוספת.</p><p><strong>דעה וספקולציה, לא עובדה ולא המלצה.</strong></p></div>
      <div className="scenario"><h3>תרחיש ב׳ — מלחמה ממושכת / מצר הורמוז סגור</h3><p>הנפט עולה, השקל נחלש, הביטחוניות מחזיקות.</p><p><strong>דעה וספקולציה, לא עובדה ולא המלצה.</strong></p></div>
      <p className="disclaimer">התרחישים הם דעה וספקולציה, לא עובדה ולא המלצה להשקעה.</p>
    </>
  );
}
