"use client";
import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import { fmtPrice, ma20Series } from "@/lib/format";

// Interactive line chart: crosshair + dot + tooltip (date, price, MA20). Rebuilt when data changes.
export default function Chart({ history, sym, full = false, ma = false, className, onPick, pinned, newsDates }) {
  const host = useRef(null);
  const lineRef = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    const wrap = host.current;
    if (!wrap || !history || history.length < 2) return;
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    wrap.appendChild(tip);
    const vals = history.map((p) => p[1]);
    const up = vals[vals.length - 1] >= vals[0];
    const color = up ? "#22c55e" : "#ef4444";
    const chart = createChart(wrap, {
      width: wrap.clientWidth, height: wrap.clientHeight,
      layout: { background: { type: "solid", color: "transparent" }, textColor: "#a3a3a3", fontSize: 10, fontFamily: "Arial, Helvetica, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { color: full ? "#262626" : "transparent" } },
      rightPriceScale: { visible: full, borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.12 } },
      leftPriceScale: { visible: false },
      timeScale: { visible: full, borderVisible: false, ticksVisible: false, fixLeftEdge: true, fixRightEdge: true,
        tickMarkFormatter: (t) => { const p = typeof t === "string" ? t.split("-").map(Number) : [t.year, t.month, t.day]; return p[2] + "." + p[1]; } },
      handleScroll: false, handleScale: false,
      crosshair: { mode: 0, vertLine: { color: "#d4d4d4", width: 1, style: 0, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      localization: { priceFormatter: (v) => (sym === "^TA125.TA" ? v.toFixed(0) : sym === "NXSN.TA" ? v.toFixed(2) + " ₪" : "$" + v.toFixed(2)) },
    });
    const maVals = ma20Series(history);
    if (ma) {
      const s = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(history.map((p, i) => ({ time: p[0], value: maVals[i] })));
    }
    const line = chart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: true, crosshairMarkerRadius: 4, crosshairMarkerBorderColor: "#fff", crosshairMarkerBackgroundColor: color });
    line.setData(history.map((p) => ({ time: p[0], value: p[1] })));
    lineRef.current = line;
    chart.timeScale().fitContent();
    const idx = {};
    history.forEach((p, i) => { idx[p[0]] = i; });
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) { tip.style.display = "none"; return; }
      const pt = param.seriesData.get(line);
      if (!pt) { tip.style.display = "none"; return; }
      const key = typeof param.time === "string" ? param.time : `${param.time.year}-${String(param.time.month).padStart(2, "0")}-${String(param.time.day).padStart(2, "0")}`;
      const [y, m, d] = key.split("-");
      let html = `<div>${d}.${m}.${y}</div><div class="tp">${fmtPrice(pt.value, sym)}</div>`;
      if (ma && idx[key] !== undefined) html += `<div class="ma">MA20 ${fmtPrice(maVals[idx[key]], sym)}</div>`;
      tip.innerHTML = html;
      tip.style.display = "block";
      const tw = tip.offsetWidth, W = wrap.clientWidth;
      let x = param.point.x + 14;
      if (x + tw > W) x = param.point.x - tw - 14;
      tip.style.left = Math.max(0, x) + "px";
      tip.style.top = Math.max(0, Math.min(param.point.y - 40, wrap.clientHeight - tip.offsetHeight)) + "px";
    });
    chart.subscribeClick((param) => {
      if (!pickRef.current || !param.time) return;
      const key = typeof param.time === "string" ? param.time : `${param.time.year}-${String(param.time.month).padStart(2, "0")}-${String(param.time.day).padStart(2, "0")}`;
      if (idx[key] !== undefined) pickRef.current(key);
    });
    const ro = new ResizeObserver(() => {
      if (wrap.clientWidth) { chart.applyOptions({ width: wrap.clientWidth }); chart.timeScale().fitContent(); }
    });
    ro.observe(wrap);
    return () => { ro.disconnect(); chart.remove(); tip.remove(); lineRef.current = null; };
  }, [history, sym, full, ma]);

  // Markers: small dots on days that have news, a white arrow on the pinned day.
  useEffect(() => {
    const line = lineRef.current;
    if (!line || !history) return;
    const days = new Set(history.map((p) => p[0]));
    const m = [];
    (newsDates || []).forEach((d) => { if (days.has(d) && d !== pinned) m.push({ time: d, position: "belowBar", color: "#94a3b8", shape: "circle", size: 0.5 }); });
    if (pinned && days.has(pinned)) m.push({ time: pinned, position: "aboveBar", color: "#ffffff", shape: "arrowDown", size: 1.2 });
    m.sort((a, b) => (a.time < b.time ? -1 : 1));
    line.setMarkers(m);
  }, [history, pinned, newsDates]);
  return <div ref={host} className={"chart-wrap " + className} />;
}
