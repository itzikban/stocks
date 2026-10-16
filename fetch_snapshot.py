#!/usr/bin/env python3
"""Snapshot builder for Or's stock tracker (repo: itzikban/stocks).

Fetches the Yahoo Finance chart API (range=4mo, interval=1d, stdlib only)
for the 8 US watchlist tickers plus the Israel tab symbols, computes
per-ticker last price, day change %, 30-day history and trend signals
using the SAME rules as check_trends.py:
  - sharp move: |day change| >= 3% vs previous close
  - trend start: 3+ consecutive same-direction days, |cumulative| >= 5%
  - MA20 cross: close crosses the 20-day moving average

Writes data.json next to this script:
  {generated_at (ISO, Asia/Jerusalem), tickers: {SYM: {...}}}

Per-ticker fetch failures are recorded as {"error": ...} and the run
continues; exit code is 0 if at least one ticker succeeded, 1 otherwise.
News is best-effort only: this script does NOT fetch news and leaves
"news": [] per ticker. Never invent news items.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TICKERS = {
    # US watchlist (Anthropic-IPO thesis)
    "GOOGL": "גוגל",
    "AMZN": "אמזון",
    "SNDK": "סאנדיסק",
    "NVDA": "נבידיה",
    "AVGO": "ברודקום",
    "CRWV": "קורוויב",
    "MU": "מייקרון",
    "ANET": "אריסטה",
    # Israel tab (live cards)
    "ESLT": "אלביט מערכות",
    "^TA125.TA": "מדד ת״א 125",
    "NXSN.TA": "נקסט ויז׳ן",
}

SHARP_PCT = 3.0
TREND_DAYS = 3
TREND_CUM_PCT = 5.0
MA_WINDOW = 20
HISTORY_DAYS = 30

OUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")


def fetch_history(ticker):
    """Daily closes (adjusted) for ~4 months via Yahoo Finance chart API."""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&range=4mo" % ticker
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    try:
        result = data["chart"]["result"][0]
        stamps = result["timestamp"]
        closes = result["indicators"]["adjclose"][0]["adjclose"]
    except (KeyError, IndexError, TypeError):
        return []
    rows = []
    for ts, c in zip(stamps, closes):
        if c is None:
            continue
        rows.append((
            datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat(),
            float(c),
        ))
    return rows


def fix_tase_units(symbol, rows):
    """TASE pitfall (Oct 2026): Yahoo sometimes returns NXSN.TA values in
    agorot instead of shekels. A NextVision price above 1000 is implausible
    in shekels (verified Oct 2026: ~187.7 ₪), so divide by 100."""
    if symbol == "NXSN.TA" and rows and rows[-1][1] > 1000:
        return [(d, c / 100.0) for d, c in rows]
    return rows


def detect_signals(rows):
    """Hebrew trend-signal strings for the latest day (same rules as check_trends.py)."""
    closes = [c for _, c in rows]
    if len(closes) < MA_WINDOW + 2:
        return []
    last = closes[-1]
    prev = closes[-2]
    day_pct = (last - prev) / prev * 100.0
    signals = []

    if abs(day_pct) >= SHARP_PCT:
        direction = "עלתה" if day_pct > 0 else "ירדה"
        signals.append("תזוזה חדה: %s %.1f%% היום" % (direction, abs(day_pct)))

    streak = 0
    cum = 0.0
    for i in range(len(closes) - 1, 0, -1):
        chg = (closes[i] - closes[i - 1]) / closes[i - 1] * 100.0
        if streak == 0:
            streak = 1 if chg > 0 else -1
            cum = chg
        elif (chg > 0 and streak > 0) or (chg < 0 and streak < 0):
            streak += 1 if streak > 0 else -1
            cum += chg
        else:
            break
    if abs(streak) >= TREND_DAYS and abs(cum) >= TREND_CUM_PCT:
        direction = "עלייה" if streak > 0 else "ירידה"
        signals.append(
            "תחילת מגמת %s: %d ימים רצופים, %.1f%% מצטבר"
            % (direction, abs(streak), cum)
        )

    ma_now = sum(closes[-MA_WINDOW:]) / MA_WINDOW
    ma_prev = sum(closes[-MA_WINDOW - 1:-1]) / MA_WINDOW
    if prev < ma_prev and last > ma_now:
        signals.append("חצתה מעלה את ממוצע 20 הימים")
    elif prev > ma_prev and last < ma_now:
        signals.append("חצתה מטה את ממוצע 20 הימים")

    return signals


def main():
    tickers = {}
    succeeded = 0
    for symbol, hebrew_name in TICKERS.items():
        try:
            rows = fetch_history(symbol)
            time.sleep(1)
        except Exception as e:  # noqa: BLE001 - per-ticker failure, keep going
            tickers[symbol] = {
                "hebrew_name": hebrew_name,
                "price": None,
                "day_pct": None,
                "history": [],
                "signals": [],
                "news": [],
                "error": str(e),
            }
            print("WARN: %s fetch failed: %s" % (symbol, e), file=sys.stderr)
            continue
        if not rows:
            tickers[symbol] = {
                "hebrew_name": hebrew_name,
                "price": None,
                "day_pct": None,
                "history": [],
                "signals": [],
                "news": [],
                "error": "empty history",
            }
            print("WARN: %s empty history" % symbol, file=sys.stderr)
            continue
        rows = fix_tase_units(symbol, rows)
        last = rows[-1][1]
        prev = rows[-2][1] if len(rows) >= 2 else None
        day_pct = (last - prev) / prev * 100.0 if prev else None
        tickers[symbol] = {
            "hebrew_name": hebrew_name,
            "price": round(last, 2),
            "day_pct": round(day_pct, 2) if day_pct is not None else None,
            "history": [[d, round(c, 2)] for d, c in rows[-HISTORY_DAYS:]],
            "signals": detect_signals(rows),
            "news": [],
        }
        succeeded += 1

    payload = {
        "generated_at": datetime.now(ZoneInfo("Asia/Jerusalem")).isoformat(),
        "generated_at_tz": "Asia/Jerusalem",
        "tickers": tickers,
    }
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print("wrote %s (%d/%d tickers)" % (OUT_FILE, succeeded, len(TICKERS)))
    return 0 if succeeded > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
