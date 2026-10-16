#!/usr/bin/env python3
"""Fetch prices (+volume) and news for the watchlist and POST them to /api/ingest.

Env: INGEST_SECRET (required), SITE_URL (default https://stocks-ecru-pi.vercel.app).
Usage: python3 ingest/push.py [--backfill-days N] [--dry-run]
Tickers come from GET /api/watchlist (falls back to fetch_snapshot.TICKERS).

News sources (no API key):
  - Google News RSS, per ticker and date window (after:/before:), vendor "Google News"
  - Yahoo Finance search news (latest items only), vendor "Yahoo Finance"
Each item keeps the original publisher in `source` and the article link in `url`.
"""
import argparse, hashlib, json, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fetch_snapshot as fs  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
NY = ZoneInfo("America/New_York")
# Search terms for news; unknown symbols use "<SYMBOL> stock".
QUERY = {
    "GOOGL": "Alphabet Google GOOGL stock", "AMZN": "Amazon AMZN stock", "SNDK": "Sandisk SNDK stock",
    "NVDA": "Nvidia NVDA stock", "AVGO": "Broadcom AVGO stock", "CRWV": "CoreWeave CRWV stock",
    "MU": "Micron MU stock", "ANET": "Arista Networks ANET stock", "TSLA": "Tesla TSLA stock",
    "ESLT": "Elbit Systems ESLT stock", "^TA125.TA": "Tel Aviv 125 index TA-125", "NXSN.TA": "NextVision Stabilized Systems",
}


def get(url, data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_prices(symbol):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=4mo" % urllib.parse.quote(symbol)
    res = json.loads(get(url))["chart"]["result"][0]
    stamps = res["timestamp"]
    closes = res["indicators"]["adjclose"][0]["adjclose"]
    vols = res["indicators"]["quote"][0].get("volume") or [None] * len(stamps)
    rows, volumes = [], []
    for ts, c, v in zip(stamps, closes, vols):
        if c is None:
            continue
        d = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        rows.append((d, float(c)))
        volumes.append((d, v))
    rows = fs.fix_tase_units(symbol, rows)
    return rows, volumes


def ticker_entry(symbol, name, rows, volumes):
    last, prev = rows[-1][1], (rows[-2][1] if len(rows) > 1 else None)
    keep = {d for d, _ in rows[-fs.HISTORY_DAYS:]}
    return {
        "hebrew_name": name, "price": round(last, 2),
        "day_pct": round((last - prev) / prev * 100, 2) if prev else None,
        "history": [[d, round(c, 2)] for d, c in rows[-fs.HISTORY_DAYS:]],
        "volumes": [[d, v] for d, v in volumes if d in keep and v is not None],
        "signals": fs.detect_signals(rows), "news": [],
    }


def item(title, url, source, vendor, dt):
    return {"date": dt.astimezone(NY).date().isoformat(), "title": title.strip(), "url": url,
            "source": source, "vendor": vendor, "published_at": dt.astimezone(timezone.utc).isoformat()}


def google_news(symbol, start, end):
    q = "%s after:%s before:%s" % (QUERY.get(symbol, symbol + " stock"), start, end)
    url = "https://news.google.com/rss/search?q=%s&hl=en-US&gl=US&ceid=US:en" % urllib.parse.quote(q)
    root = ET.fromstring(get(url))
    out = []
    for it in root.iter("item"):
        src = it.find("source")
        title = it.findtext("title") or ""
        pub = it.findtext("pubDate")
        link = it.findtext("link")
        if not (title and pub and link):
            continue
        source = src.text if src is not None else None
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        out.append(item(title, link, source, "Google News", parsedate_to_datetime(pub)))
    return out


def yahoo_news(symbol):
    url = "https://query1.finance.yahoo.com/v1/finance/search?q=%s&newsCount=30&quotesCount=0" % urllib.parse.quote(symbol)
    out = []
    for n in json.loads(get(url)).get("news", []):
        if n.get("link") and n.get("title") and n.get("providerPublishTime"):
            out.append(item(n["title"], n["link"], n.get("publisher"), "Yahoo Finance",
                            datetime.fromtimestamp(n["providerPublishTime"], tz=timezone.utc)))
    return out


# Keyword classification (English headlines). Only items matching a category are kept: "important only".
# This labels the topic of the headline. It is not an interpretation of price impact.
CATEGORIES = [
    ("earnings", "דוחות", r"\b(earnings|eps|quarterly results|q[1-4] (results|revenue|profit)|revenue (beat|miss)|beats? estimates|misses? estimates)\b"),
    ("analyst", "אנליסטים", r"\b(upgrade[sd]?|downgrade[sd]?|price target|initiates? coverage|raises? (target|rating)|cuts? (target|rating)|overweight|underweight|outperform|underperform)\b"),
    ("guidance", "תחזית", r"\b(guidance|outlook|forecast (raise|cut)|raises? forecast|cuts? forecast|lowers? forecast)\b"),
    ("legal", "רגולציה/משפט", r"\b(sec (probe|charges?|investigation|filing)|ftc|doj|antitrust|lawsuit|sues?|sued|probe|investigation|fined?|tariffs?|export (curbs?|controls?|restrictions?)|recall|settlement|regulators?|fda approval|regulatory approval|nhtsa)\b"),
    ("deal", "מיזוג/עסקה", r"\b(acquires?|acquired|acquisition|merger|buyout|takeover|stake in|(billion|\$\d+(\.\d+)?\s?b) (deal|contract|order)|contract (win|award)|awarded (a )?contract|strategic partnership)\b"),
    ("offering", "הנפקה/מימון", r"\b(public offering|secondary offering|ipo|share (sale|buyback|repurchase)|buyback|dividend|stock split|convertible notes?)\b"),
]
CAT_RE = [(k, he, re.compile(rx, re.I)) for k, he, rx in CATEGORIES]


# Routine filings/holdings spam ("shares acquired by <fund>") is not company news.
NOISE = re.compile(r"(shares|stock|position|stake)\b.{0,40}\b(acquired|bought|purchased|sold|trimmed|boosted|lifted|cut|raised|lowered|reduced|increased|decreased)\b.{0,15}\bby\b|\b(acquires?|buys|sells|boosts|lifts|trims|cuts|raises|lowers|reduces) (a )?(new )?(position|stake|shares)|holdings (in|of)|\b13f\b|institutional (investor|ownership)", re.I)


def classify(title):
    if NOISE.search(title):
        return []
    return [{"key": k, "label": he} for k, he, rx in CAT_RE if rx.search(title)]


def news_for(symbol, backfill_days, moves=None):
    """Returns (items, failures). Failures are fetch errors (logged and counted, never swallowed)."""
    failures = []
    today = datetime.now(NY).date()
    items = []
    span = 5 if backfill_days > 5 else 3
    n_days = backfill_days if backfill_days else 3
    end = today + timedelta(days=1)
    start_limit = today - timedelta(days=n_days)
    while end > start_limit:
        start = max(start_limit, end - timedelta(days=span))
        try:
            items += google_news(symbol, start.isoformat(), end.isoformat())
        except Exception as e:  # noqa: BLE001
            failures.append("google %s" % start)
            print("ERROR google news %s %s: %s" % (symbol, start, e), file=sys.stderr, flush=True)
        time.sleep(1)
        end = start
    try:
        items += yahoo_news(symbol)
    except Exception as e:  # noqa: BLE001
        failures.append("yahoo")
        print("ERROR yahoo news %s: %s" % (symbol, e), file=sys.stderr, flush=True)
    seen, out = set(), []
    moves = moves or {}
    for it in items:
        cats = classify(it["title"])
        if cats and abs(moves.get(it["date"], 0) or 0) >= fs.SHARP_PCT:
            cats.append({"key": "move", "label": "יום עם תזוזה חדה"})
        if not cats:
            continue
        it["categories"] = cats
        key = re.sub(r"\W+", "", it["title"].lower())[:80]
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out, failures


def with_retry(fn, what, tries=4):
    """Retry with backoff (longer on HTTP 429). Raises the last error."""
    delay = 2
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            code = getattr(e, "code", None)
            if i == tries - 1:
                raise
            wait = delay * (4 if code == 429 else 1)
            print("retry %s in %ds (%s)" % (what, wait, e), file=sys.stderr, flush=True)
            time.sleep(wait)
            delay *= 2


def item_id(sym, url):
    return hashlib.sha1((sym + "|" + url).encode()).hexdigest()[:12]


def existing_translated(site, symbols):
    """ids of items already stored with a Hebrew title (so they are never re-translated)."""
    have = {}
    for sym in symbols:
        try:
            for n in json.loads(get(site + "/api/news?symbol=" + urllib.parse.quote(sym))).get("news", []):
                if n.get("title_he"):
                    have[item_id(sym, n["url"])] = n["title_he"]
        except Exception as e:  # noqa: BLE001
            print("WARN could not read stored news for %s: %s" % (sym, e), file=sys.stderr)
    return have


def apply_translations(payload, translations, have):
    missing = 0
    for sym, items in payload["news"].items():
        for it in items:
            iid = item_id(sym, it["url"])
            he = translations.get(iid) or have.get(iid)
            if he and isinstance(he, str) and he.strip():
                it["title_he"] = he.strip()[:400]
            else:
                missing += 1
    return missing


def post(site, auth, payload):
    body = json.dumps(payload, ensure_ascii=False).encode()
    resp = get(site + "/api/ingest", data=body, headers={**auth, "Content-Type": "application/json"}, timeout=120)
    print("ingest:", resp.decode()[:200])


def main():
    """Exit codes: 0 ok; 1 nothing fetched (nothing posted); 2 watchlist unavailable (nothing posted);
    3 some prices failed (posted, failed tickers carried over from the last snapshot and marked stale,
    or omitted if the site never had them); 4 only news fetching had failures (prices posted)."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill-days", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stage", metavar="DIR", help="fetch everything, write DIR/payload.json and DIR/untranslated.json, do not post")
    ap.add_argument("--post", metavar="DIR", help="post DIR/payload.json after applying DIR/translations.json (id -> Hebrew title)")
    ap.add_argument("--translations", metavar="FILE", help="translations file for --post (default DIR/translations.json)")
    a = ap.parse_args()
    site = os.environ.get("SITE_URL", "https://stocks-ecru-pi.vercel.app").rstrip("/")
    secret = os.environ.get("INGEST_SECRET", "").strip()
    if not secret and not a.dry_run:
        print("ERROR: INGEST_SECRET missing", file=sys.stderr)
        return 2
    auth = {"Authorization": "Bearer " + secret}
    if a.post:
        payload = json.load(open(os.path.join(a.post, "payload.json"), encoding="utf8"))
        tpath = a.translations or os.path.join(a.post, "translations.json")
        tr = json.load(open(tpath, encoding="utf8")) if os.path.exists(tpath) else {}
        have = existing_translated(site, list(payload["news"]))
        missing = apply_translations(payload, tr, have)
        print("translations applied: %d provided, %d items without Hebrew (posted with original title)" % (len(tr), missing))
        post(site, auth, payload)
        return payload.get("_exit", 0)
    # Fail closed: without the real watchlist we must not post (it could drop added tickers).
    try:
        wl = with_retry(lambda: json.loads(get(site + "/api/watchlist", headers=auth))["watchlist"], "watchlist")
        if not wl:
            raise RuntimeError("empty watchlist")
    except Exception as e:  # noqa: BLE001
        print("ERROR: watchlist unavailable, nothing posted: %s" % e, file=sys.stderr)
        return 2
    try:
        last_good = with_retry(lambda: json.loads(get(site + "/api/data"))["snapshot"].get("tickers", {}), "last snapshot")
    except Exception as e:  # noqa: BLE001
        print("WARN: could not read last snapshot, failed tickers will be omitted: %s" % e, file=sys.stderr)
        last_good = {}
    tickers, news, price_fail, news_fail = {}, {}, [], []
    for w in wl:
        sym = w["symbol"]
        try:
            rows, vols = with_retry(lambda: fetch_prices(sym), "prices " + sym)
            if len(rows) < 2:
                raise RuntimeError("empty price history")
            tickers[sym] = ticker_entry(sym, w["name"], rows, vols)
        except Exception as e:  # noqa: BLE001
            price_fail.append(sym)
            print("ERROR prices %s: %s" % (sym, e), file=sys.stderr, flush=True)
            old = last_good.get(sym)
            if old and old.get("price") is not None:
                old = dict(old)
                old["stale"] = True
                old["stale_reason"] = str(e)[:120]
                old["stale_checked_at"] = datetime.now(ZoneInfo("Asia/Jerusalem")).isoformat()
                tickers[sym] = old
            continue
        time.sleep(1)
        h = tickers[sym]["history"]
        moves = {h[i][0]: (h[i][1] - h[i - 1][1]) / h[i - 1][1] * 100 for i in range(1, len(h))}
        news[sym], nf = news_for(sym, a.backfill_days, moves)
        if nf:
            news_fail.append("%s(%s)" % (sym, ",".join(nf)))
        print("%s: price %.2f, %d important news" % (sym, tickers[sym]["price"], len(news[sym])), flush=True)
    fresh = [s for s in tickers if not tickers[s].get("stale")]
    if not fresh:
        print("ERROR: no ticker fetched successfully, nothing posted", file=sys.stderr)
        return 1
    payload = {"generated_at": datetime.now(ZoneInfo("Asia/Jerusalem")).isoformat(), "tickers": tickers, "news": news}
    status = 3 if price_fail else (4 if news_fail else 0)
    if a.stage:
        have = existing_translated(site, list(news))
        todo = [{"id": item_id(sym, it["url"]), "symbol": sym, "title": it["title"]}
                for sym, items in news.items() for it in items if item_id(sym, it["url"]) not in have]
        os.makedirs(a.stage, exist_ok=True)
        payload["_exit"] = status
        json.dump(payload, open(os.path.join(a.stage, "payload.json"), "w", encoding="utf8"), ensure_ascii=False)
        json.dump(todo, open(os.path.join(a.stage, "untranslated.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
        print("staged: %d tickers, %d news, %d need Hebrew translation -> %s" % (len(tickers), sum(len(v) for v in news.values()), len(todo), a.stage))
    elif a.dry_run:
        print("dry run: %d tickers (%d stale), %d news" % (len(tickers), len(tickers) - len(fresh), sum(len(v) for v in news.values())))
    else:
        have = existing_translated(site, list(news))
        apply_translations(payload, {}, have)
        post(site, auth, payload)
    if price_fail:
        print("FAILED prices: %s (stale carried over where available)" % ",".join(price_fail), file=sys.stderr)
        return 3
    if news_fail:
        print("FAILED news only: %s" % ",".join(news_fail), file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
