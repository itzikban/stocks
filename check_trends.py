#!/usr/bin/env python3
"""Stock trend alerts for Or's 8-stock Anthropic-IPO watchlist.

Repo copy: this file lives in https://github.com/itzikban/stocks
(originally ~/workspace/stock-tracker/check_trends.py).
The only intentional difference from the original: STATE_FILE resolves
next to this script (overridable via STOCS_STATE_FILE env var).

Fetches daily history from Yahoo Finance chart API (free, no key), detects:
  - sharp move: |day change| >= 3% vs previous close
  - trend start: 3+ consecutive same-direction days with |cumulative| >= 5%
  - MA20 cross: close crosses the 20-day moving average
Dedups via STATE_FILE so each event alerts only once.
Prints new alerts as Hebrew lines (one per line). Prints nothing when quiet.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

TICKERS = {
    "GOOGL": "גוגל",
    "AMZN": "אמזון",
    "SNDK": "סאנדיסק",
    "NVDA": "נבידיה",
    "AVGO": "ברודקום",
    "CRWV": "קורוויב",
    "MU": "מייקרון",
    "ANET": "אריסטה",
}

SHARP_PCT = 3.0
TREND_DAYS = 3
TREND_CUM_PCT = 5.0
MA_WINDOW = 20

STATE_FILE = os.environ.get(
    "STOCS_STATE_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "alert-state.json"),
)
HISTORY_DAYS = 120


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


def detect(rows):
    """Return list of (event_key_suffix, hebrew_text) for the latest day."""
    closes = [c for _, c in rows]
    dates = [d for d, _ in rows]
    if len(closes) < MA_WINDOW + 2:
        return []
    last = closes[-1]
    prev = closes[-2]
    last_date = dates[-1]
    day_pct = (last - prev) / prev * 100.0
    events = []

    if abs(day_pct) >= SHARP_PCT:
        direction = "עלתה" if day_pct > 0 else "ירדה"
        events.append((
            "sharp",
            "תזוזה חדה: %s %.1f%% היום (%.2f$)" % (direction, abs(day_pct), last),
        ))

    # streak of same-direction daily moves ending today
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
        events.append((
            "trend-%s" % ("up" if streak > 0 else "down"),
            "תחילת מגמת %s: %d ימים רצופים, %.1f%% מצטבר (%.2f$)"
            % (direction, abs(streak), cum, last),
        ))

    ma_now = sum(closes[-MA_WINDOW:]) / MA_WINDOW
    ma_prev = sum(closes[-MA_WINDOW - 1:-1]) / MA_WINDOW
    if prev < ma_prev and last > ma_now:
        events.append(("ma-cross-up", "חצתה מעלה את ממוצע 20 הימים (%.2f$)" % last))
    elif prev > ma_prev and last < ma_now:
        events.append(("ma-cross-down", "חצתה מטה את ממוצע 20 הימים (%.2f$)" % last))

    return [(last_date + ":" + key, text) for key, text in events]


def main():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            state = json.load(f)
    except (OSError, ValueError):
        state = {}

    new_alerts = []
    warnings = []
    for ticker, hebrew_name in TICKERS.items():
        try:
            rows = fetch_history(ticker)
            time.sleep(1)
        except Exception as e:  # noqa: BLE001 - keep the run going
            warnings.append("%s: שגיאת משיכה (%s)" % (ticker, e))
            continue
        if len(rows) < MA_WINDOW + 2:
            warnings.append("%s: אין מספיק היסטוריה" % ticker)
            continue
        seen = set(state.get(ticker, []))
        for key, text in detect(rows):
            if key not in seen:
                new_alerts.append("‏%s (%s): %s" % (hebrew_name, ticker, text))
                seen.add(key)
        # prune keys older than 30 days
        cutoff = (date.today() - timedelta(days=30)).isoformat()
        state[ticker] = sorted(k for k in seen if k >= cutoff)

    parent = os.path.dirname(STATE_FILE)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)

    for a in new_alerts:
        print(a)
    for w in warnings:
        print("WARN: " + w, file=sys.stderr)


if __name__ == "__main__":
    main()
