/* Mesh UI mockups: shell, fake data and SVG charts.
   Usage in a page:
     <body data-page="overview" data-title="Overview">
       <div id="page" class="page"> ...content... </div>
       <script src="assets/mockup.js"></script>
       <script> MU.ready(() => { MU.area('#chart', {...}) }) </script>
   Charts follow AGENTS.md "Dashboards and charts": monotone curves, 2px lines,
   12% area fill, horizontal gridlines at nice ticks, quiet labels, hover
   crosshair + glass tooltip. */
(function () {
  "use strict";

  // ---------- Navigation (one entry per mockup page) ----------
  const NAV = [
    { group: "Network" },
    { id: "overview", file: "01-overview.html", label: "Overview", icon: "layout-dashboard", c: "var(--s-blue)" },
    { id: "internet", file: "02-internet.html", label: "Internet", icon: "globe", c: "var(--s-aqua)" },
    { id: "eeros", file: "03-eeros.html", label: "eeros", icon: "router", c: "var(--s-blue)", meta: "4" },
    { id: "devices", file: "05-devices.html", label: "Devices", icon: "monitor-smartphone", c: "var(--s-purple)", meta: "38" },
    { id: "profiles", file: "07-profiles.html", label: "Profiles", icon: "users", c: "var(--s-orange)", meta: "5" },
    { id: "activity", file: "10-activity.html", label: "Activity", icon: "activity", c: "var(--s-red)" },
    { id: "guest", file: "11-guest.html", label: "Guest network", icon: "ticket", c: "var(--s-yellow)" },
    { group: "Settings" },
    { id: "wifi", file: "12-wifi-settings.html", label: "Wi-Fi", icon: "wifi", c: "var(--s-blue)" },
    { id: "advanced", file: "13-advanced-networking.html", label: "Advanced networking", icon: "sliders-horizontal", c: "var(--s-purple)" },
    { id: "ports", file: "14-reservations-ports.html", label: "Reservations & ports", icon: "arrow-left-right", c: "var(--s-aqua)" },
    { id: "updates", file: "15-updates-admins.html", label: "Updates & admins", icon: "download", c: "var(--s-blue)" },
    { id: "troubleshoot", file: "16-troubleshooting.html", label: "Troubleshooting", icon: "stethoscope", c: "var(--s-orange)" },
    { id: "account", file: "17-account-settings.html", label: "App & account", icon: "settings", c: "var(--s-gray)" },
  ];

  // ---------- Helpers ----------
  const $ = (s, r = document) => (typeof s === "string" ? r.querySelector(s) : s);
  const el = (tag, attrs = {}, html = "") => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (html) n.innerHTML = html;
    return n;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs = {}) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // Seeded random so mockups look the same on every load.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Smooth-ish random walk: n points around base, +-spread, optional daily shape. */
  function series(n, { base = 50, spread = 20, seed = 1, min = 0, daily = false, spikes = 0 } = {}) {
    const r = rng(seed);
    const out = [];
    let v = base;
    for (let i = 0; i < n; i++) {
      v += (r() - 0.5) * spread * 0.6;
      v += (base - v) * 0.18;
      let x = v;
      if (daily) {
        const h = (i % 24) / 24;
        x *= 0.35 + 0.9 * Math.max(0, Math.sin((h - 0.28) * Math.PI)) + 0.45 * Math.exp(-((h - 0.85) ** 2) / 0.006);
      }
      if (spikes && r() < spikes) x *= 1.8 + r();
      out.push(Math.max(min, x));
    }
    return out;
  }

  const fmt = {
    mbps: (v) => (v >= 1000 ? (v / 1000).toFixed(2) + " Gbps" : Math.round(v) + " Mbps"),
    gb: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " TB" : v >= 10 ? Math.round(v) + " GB" : v.toFixed(1) + " GB"),
    mb: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " GB" : Math.round(v) + " MB"),
    int: (v) => Math.round(v).toLocaleString(),
    pct: (v) => Math.round(v) + "%",
    ms: (v) => Math.round(v) + " ms",
  };

  function niceScale(peak, count = 4) {
    if (peak <= 0) return { max: 1, ticks: [0, 1] };
    const raw = peak / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag;
    const max = Math.ceil(peak / step) * step;
    const ticks = [];
    for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
    return { max, ticks };
  }

  // Monotone cubic (Fritsch-Carlson), ported from T3 Code's UsageProviderChart.
  function monotonePath(pts) {
    const n = pts.length;
    if (n < 2) return "";
    const s = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x;
      s.push(dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx);
    }
    const t = new Array(n).fill(0);
    t[0] = s[0];
    t[n - 1] = s[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (s[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / s[i], b = t[i + 1] / s[i], m = a * a + b * b;
      if (m > 9) { const k = 3 / Math.sqrt(m); t[i] = k * a * s[i]; t[i + 1] = k * b * s[i]; }
    }
    let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
      const p = pts[i], q = pts[i + 1], dx = q.x - p.x;
      d += ` C${(p.x + dx / 3).toFixed(2)},${(p.y + (t[i] * dx) / 3).toFixed(2)} ${(q.x - dx / 3).toFixed(2)},${(q.y - (t[i + 1] * dx) / 3).toFixed(2)} ${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    }
    return d;
  }

  // ---------- Area / line chart ----------
  /**
   * MU.area(target, {
   *   series: [{ name, color, values, dashed?, fill? (default true) }],
   *   labels: [...x labels per point], xTicks?: [start, mid, end] override,
   *   height: 220, format: fn, stacked: false, yLabels: true, total: true,
   *   markers: [{ i, label, color }]  // optional vertical markers
   * })
   */
  function area(target, o) {
    const host = $(target);
    if (!host) return;
    const W = 960, H = 260, TOP = 8;
    const height = o.height ?? 220;
    const format = o.format ?? fmt.int;
    const n = o.series[0].values.length;
    const stacked = !!o.stacked;
    const sums = new Array(n).fill(0);
    const layers = o.series.map((s) => {
      const base = sums.slice();
      const top = s.values.map((v, i) => (stacked ? (sums[i] += v) : v));
      return { ...s, base, top };
    });
    const peak = Math.max(...layers.map((l) => Math.max(...l.top)));
    const scale = o.max ? { max: o.max, ticks: o.ticks ?? niceScale(o.max).ticks } : niceScale(peak * 1.04);
    const y = (v) => H - (v / scale.max) * (H - TOP);
    const stepX = n < 2 ? 0 : W / (n - 1);

    host.classList.add("chart");
    host.innerHTML = "";
    const body = el("div", { class: "chart-body" });
    const yax = el("div", { class: "chart-y", style: `height:${height}px` });
    if (o.yLabels !== false) {
      for (const t of scale.ticks) yax.appendChild(el("span", { style: `top:${(y(t) / H) * 100}%` }, t === 0 ? "0" : format(t)));
    } else yax.style.width = "0";
    const plot = el("div", { class: "chart-plot", style: `height:${height}px` });
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": o.label ?? "chart" });

    for (const t of scale.ticks) {
      svg.appendChild(sv("line", { x1: 0, x2: W, y1: y(t), y2: y(t), stroke: "var(--grid)", "stroke-width": 1, "vector-effect": "non-scaling-stroke" }));
    }
    for (const m of o.markers ?? []) {
      svg.appendChild(sv("line", { x1: m.i * stepX, x2: m.i * stepX, y1: TOP, y2: H, stroke: m.color ?? "var(--muted-2)", "stroke-width": 1, "stroke-dasharray": "3 4", "vector-effect": "non-scaling-stroke" }));
    }
    const drawOrder = stacked ? layers : [...layers].sort((a, b) => b.top.reduce((x, v) => x + v, 0) - a.top.reduce((x, v) => x + v, 0));
    const defs = sv("defs");
    svg.appendChild(defs);
    drawOrder.forEach((l, k) => {
      const topPts = l.top.map((v, i) => ({ x: i * stepX, y: y(v) }));
      const line = monotonePath(topPts);
      if (l.fill !== false) {
        const gid = `g${Math.random().toString(36).slice(2, 8)}`;
        const g = sv("linearGradient", { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
        g.appendChild(sv("stop", { offset: "0%", "stop-color": l.color, "stop-opacity": 0.12 }));
        g.appendChild(sv("stop", { offset: "100%", "stop-color": l.color, "stop-opacity": 0.12 }));
        defs.appendChild(g);
        let d;
        if (stacked) {
          const basePts = l.base.map((v, i) => ({ x: i * stepX, y: y(v) })).reverse();
          d = line + " L" + monotonePath(basePts).slice(1) + " Z";
        } else d = `${line} L${W},${H} L0,${H} Z`;
        svg.appendChild(sv("path", { d, fill: `url(#${gid})` }));
      }
      l._line = line;
    });
    drawOrder.forEach((l) => {
      svg.appendChild(sv("path", { d: l._line, fill: "none", stroke: l.color, "stroke-width": l.width ?? 2, "stroke-linecap": "round", "stroke-dasharray": l.dashed ? "5 5" : "none", "vector-effect": "non-scaling-stroke" }));
    });

    // Hover
    const cross = sv("line", { y1: TOP, y2: H, stroke: "var(--muted-2)", "stroke-width": 1, "vector-effect": "non-scaling-stroke", visibility: "hidden" });
    svg.appendChild(cross);
    plot.appendChild(svg);
    const dots = layers.map((l) => {
      const d = el("div", { style: `position:absolute;width:9px;height:9px;border-radius:99px;background:${l.color};box-shadow:0 0 0 3px color-mix(in srgb, ${l.color} 25%, transparent), 0 0 0 1.5px var(--card) inset;transform:translate(-50%,-50%);display:none;pointer-events:none` });
      plot.appendChild(d);
      return d;
    });
    const tip = el("div", { class: "tip", style: "display:none" });
    plot.appendChild(tip);
    plot.addEventListener("mousemove", (e) => {
      const b = plot.getBoundingClientRect();
      const lx = Math.min(b.width, Math.max(0, e.clientX - b.left));
      const i = Math.round((lx / b.width) * (n - 1));
      cross.setAttribute("x1", i * stepX); cross.setAttribute("x2", i * stepX); cross.setAttribute("visibility", "visible");
      const px = (i / (n - 1)) * b.width;
      layers.forEach((l, k) => { dots[k].style.display = "block"; dots[k].style.left = px + "px"; dots[k].style.top = (y(l.top[i]) / H) * b.height + "px"; });
      const total = layers.reduce((s, l) => s + l.values[i], 0);
      tip.innerHTML = `<div class="h">${(o.tipLabels ?? o.labels)?.[i] ?? ""}</div>` +
        layers.map((l) => `<div class="rw"><span><i class="sw" style="--c:${l.color}"></i>${l.name}</span><b>${format(l.values[i])}</b></div>`).join("") +
        (o.total && layers.length > 1 ? `<div class="rw tot"><span>Total</span><b>${format(total)}</b></div>` : "");
      tip.style.display = "block";
      const ly = e.clientY - b.top, tw = tip.offsetWidth, th = tip.offsetHeight;
      const left = lx + 14 + tw <= b.width ? lx + 14 : lx - 14 - tw;
      const top = ly + 14 + th <= b.height ? ly + 14 : ly - 14 - th;
      tip.style.left = Math.max(0, left) + "px"; tip.style.top = Math.max(0, top) + "px";
    });
    plot.addEventListener("mouseleave", () => { tip.style.display = "none"; cross.setAttribute("visibility", "hidden"); dots.forEach((d) => (d.style.display = "none")); });

    body.append(yax, plot);
    host.appendChild(body);
    if (o.labels && o.xAxis !== false) {
      const xs = o.xTicks ?? [o.labels[0], o.labels[Math.floor(n / 2)], o.labels[n - 1]];
      const xa = el("div", { class: "chart-x" });
      if (o.yLabels === false) xa.style.paddingLeft = "0";
      xs.forEach((t) => xa.appendChild(el("span", {}, t)));
      host.appendChild(xa);
    }
  }

  // ---------- Bar chart (stacked columns) ----------
  /** MU.bars(target, { series:[{name,color,values}], labels, height, format, gap:0.35, highlight: i }) */
  function bars(target, o) {
    const host = $(target);
    if (!host) return;
    const height = o.height ?? 180;
    const format = o.format ?? fmt.int;
    const n = o.series[0].values.length;
    const totals = Array.from({ length: n }, (_, i) => o.series.reduce((s, x) => s + x.values[i], 0));
    const scale = niceScale(Math.max(...totals) * 1.04);
    host.classList.add("chart");
    host.innerHTML = "";
    const body = el("div", { class: "chart-body" });
    const yax = el("div", { class: "chart-y", style: `height:${height}px` });
    if (o.yLabels !== false) for (const t of scale.ticks) yax.appendChild(el("span", { style: `top:${100 - (t / scale.max) * 100}%` }, t === 0 ? "0" : format(t)));
    else yax.style.width = "0";
    const plot = el("div", { class: "chart-plot", style: `height:${height}px;display:flex;align-items:flex-end;gap:${o.gapPx ?? 4}px` });
    const grid = el("div", { style: "position:absolute;inset:0;pointer-events:none" });
    for (const t of scale.ticks) grid.appendChild(el("div", { style: `position:absolute;left:0;right:0;top:${100 - (t / scale.max) * 100}%;border-top:1px solid var(--grid)` }));
    plot.appendChild(grid);
    const tip = el("div", { class: "tip", style: "display:none" });
    for (let i = 0; i < n; i++) {
      const colEl = el("div", { style: `position:relative;flex:1;height:100%;display:flex;flex-direction:column-reverse;gap:2px;cursor:default;opacity:${o.highlight != null && o.highlight !== i ? 0.55 : 1}` });
      o.series.forEach((s, k) => {
        const h = (s.values[i] / scale.max) * 100;
        colEl.appendChild(el("div", { style: `height:${h}%;min-height:${s.values[i] > 0 ? 2 : 0}px;background:${s.color};border-radius:${k === o.series.length - 1 ? "4px 4px 1px 1px" : "1px"}` }));
      });
      colEl.addEventListener("mouseenter", () => {
        tip.innerHTML = `<div class="h">${o.labels?.[i] ?? ""}</div>` + o.series.map((s) => `<div class="rw"><span><i class="sw" style="--c:${s.color}"></i>${s.name}</span><b>${format(s.values[i])}</b></div>`).join("") + (o.series.length > 1 ? `<div class="rw tot"><span>Total</span><b>${format(totals[i])}</b></div>` : "");
        tip.style.display = "block";
        const b = plot.getBoundingClientRect(), cb = colEl.getBoundingClientRect();
        let left = cb.left - b.left + cb.width + 8;
        if (left + tip.offsetWidth > b.width) left = cb.left - b.left - tip.offsetWidth - 8;
        tip.style.left = left + "px"; tip.style.top = "6px";
        colEl.style.filter = "brightness(1.15)";
      });
      colEl.addEventListener("mouseleave", () => { tip.style.display = "none"; colEl.style.filter = ""; });
      plot.appendChild(colEl);
    }
    plot.appendChild(tip);
    body.append(yax, plot);
    host.appendChild(body);
    if (o.labels && o.xAxis !== false) {
      const xa = el("div", { class: "chart-x" });
      if (o.yLabels === false) xa.style.paddingLeft = "0";
      (o.xTicks ?? [o.labels[0], o.labels[Math.floor(n / 2)], o.labels[n - 1]]).forEach((t) => xa.appendChild(el("span", {}, t)));
      host.appendChild(xa);
    }
  }

  // ---------- Sparkline ----------
  /** MU.spark(target, values, color, { height: 32, fill: true }) */
  function spark(target, values, color, o = {}) {
    const host = $(target);
    if (!host) return;
    const W = 200, H = 40, n = values.length;
    const max = Math.max(...values) * 1.08 || 1, min = o.zero === false ? Math.min(...values) * 0.9 : 0;
    const pts = values.map((v, i) => ({ x: (i / (n - 1)) * W, y: H - ((v - min) / (max - min)) * (H - 3) }));
    const line = monotonePath(pts);
    const gid = "s" + Math.random().toString(36).slice(2, 8);
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${o.height ?? 32}px;overflow:visible">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.1"/><stop offset="100%" stop-color="${color}" stop-opacity="0.1"/></linearGradient></defs>
      ${o.fill === false ? "" : `<path d="${line} L${W},${H} L0,${H} Z" fill="url(#${gid})"/>`}
      <path d="${line}" fill="none" stroke="${color}" stroke-width="${o.width ?? 1.75}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${o.dot === false ? "" : `<circle cx="${pts[n - 1].x}" cy="${pts[n - 1].y}" r="2.6" fill="${color}" vector-effect="non-scaling-stroke"/>`}
    </svg>`;
  }

  // ---------- Donut ----------
  /** MU.donut(target, [{name,color,value}], { size:132, thickness:14, center:"html" }) */
  function donut(target, segs, o = {}) {
    const host = $(target);
    if (!host) return;
    const size = o.size ?? 132, th = o.thickness ?? 14, r = (size - th) / 2, C = 2 * Math.PI * r;
    const total = segs.reduce((s, x) => s + x.value, 0);
    const gap = segs.length > 1 ? (o.gap ?? 3) : 0;
    let off = 0;
    const arcs = segs.map((s) => {
      const len = (s.value / total) * C;
      const a = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${th}" stroke-linecap="round"
        stroke-dasharray="${Math.max(0.01, len - gap - th * 0.0)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${s.name}</title></circle>`;
      off += len;
      return a;
    });
    host.style.position = "relative";
    host.style.width = size + "px";
    host.style.height = size + "px";
    host.innerHTML = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card-2)" stroke-width="${th}"/>${arcs.join("")}</svg>
      <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center">${o.center ?? ""}</div>`;
  }

  // ---------- Gauge (speed) ----------
  /** MU.gauge(target, { value, max, color, label, unit, size }) 240-degree arc. */
  function gauge(target, o) {
    const host = $(target);
    if (!host) return;
    const size = o.size ?? 180, th = o.thickness ?? 12, r = (size - th) / 2 - 2, cx = size / 2, cy = size / 2;
    const a0 = 150, sweep = 240, frac = Math.min(1, o.value / o.max);
    const pt = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
    const arc = (from, to) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M${x1},${y1} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`; };
    const gid = "gg" + Math.random().toString(36).slice(2, 8);
    const ticks = [];
    for (let k = 0; k <= 12; k++) {
      const d = a0 + (sweep * k) / 12, i1 = r - th / 2 - 6, i2 = r - th / 2 - (k % 3 === 0 ? 12 : 9);
      const p1 = [cx + i1 * Math.cos((d * Math.PI) / 180), cy + i1 * Math.sin((d * Math.PI) / 180)], p2 = [cx + i2 * Math.cos((d * Math.PI) / 180), cy + i2 * Math.sin((d * Math.PI) / 180)];
      ticks.push(`<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="var(--muted-2)" stroke-width="${k % 3 === 0 ? 1.5 : 1}" opacity="0.6"/>`);
    }
    host.style.position = "relative"; host.style.width = size + "px"; host.style.height = size * 0.86 + "px";
    host.innerHTML = `<svg width="${size}" height="${size}" style="overflow:visible">
      <defs><linearGradient id="${gid}" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="${o.color}"/><stop offset="100%" stop-color="${o.color}"/></linearGradient></defs>
      <path d="${arc(a0, a0 + sweep)}" fill="none" stroke="var(--card-2)" stroke-width="${th}" stroke-linecap="round"/>
      <path d="${arc(a0, a0 + sweep * frac)}" fill="none" stroke="url(#${gid})" stroke-width="${th}" stroke-linecap="round"/>
      ${ticks.join("")}
    </svg>
    <div style="position:absolute;left:0;right:0;top:${size * 0.3}px;text-align:center">
      <div class="xxxs up muted b">${o.label ?? ""}</div>
      <div style="font-size:${size * 0.19}px;font-weight:650;letter-spacing:-0.03em;line-height:1.1" class="tnum">${o.text ?? o.value}</div>
      <div class="xs muted">${o.unit ?? ""}</div>
    </div>`;
  }

  // ---------- Heatmap (e.g. 7 days x 24 hours) ----------
  /** MU.heat(target, { rows:[label], cols: 24, values: rows x cols (0..1), color, cell: 14 }) */
  function heat(target, o) {
    const host = $(target);
    if (!host) return;
    const cols = o.cols ?? 24;
    const rows = o.rows;
    let h = `<div style="display:grid;grid-template-columns:34px repeat(${cols},1fr);gap:3px;align-items:center">`;
    rows.forEach((label, ri) => {
      h += `<div class="xxxs muted up">${label}</div>`;
      for (let c = 0; c < cols; c++) {
        const v = o.values[ri][c];
        h += `<div title="${label} ${c}:00 · ${Math.round(v * 100)}%" style="height:${o.cell ?? 14}px;border-radius:3px;background:color-mix(in srgb, ${o.color} ${Math.round(8 + v * 88)}%, var(--card-2))"></div>`;
      }
    });
    h += `<div></div>`;
    for (let c = 0; c < cols; c++) h += `<div class="xxxs muted-2" style="text-align:center">${c % 6 === 0 ? (c === 0 ? "12a" : c === 12 ? "12p" : c < 12 ? c + "a" : c - 12 + "p") : ""}</div>`;
    host.innerHTML = h + "</div>";
  }

  /** Values grid for heat(): rows x cols with a daily rhythm. */
  function heatValues(rows, cols, seed = 3) {
    const r = rng(seed);
    return Array.from({ length: rows }, (_, ri) => Array.from({ length: cols }, (_, c) => {
      const h = c / cols;
      const base = 0.08 + 0.55 * Math.max(0, Math.sin((h - 0.3) * Math.PI)) + 0.5 * Math.exp(-((h - 0.86) ** 2) / 0.004);
      const weekend = ri >= 5 ? 0.15 : 0;
      return Math.min(1, Math.max(0, base + weekend + (r() - 0.5) * 0.25));
    }));
  }

  /** Time labels helpers. */
  const labels = {
    hours(n = 24, endHour = 14) {
      return Array.from({ length: n }, (_, i) => {
        const h = (endHour - (n - 1 - i) + 48) % 24;
        return h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
      });
    },
    days(n = 30, end = new Date(2026, 10, 12)) {
      const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return Array.from({ length: n }, (_, i) => { const d = new Date(end); d.setDate(d.getDate() - (n - 1 - i)); return `${m[d.getMonth()]} ${d.getDate()}`; });
    },
    weekdays(n = 7) {
      const w = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
      return Array.from({ length: n }, (_, i) => w[(i + 7 - (n % 7)) % 7]);
    },
  };

  // ---------- Shell ----------
  function shell() {
    const body = document.body;
    const page = $("#page");
    if (!page) return;
    const params = new URLSearchParams(location.search);
    const theme = params.get("theme") || localStorage.getItem("mu-theme") || "dark";
    document.documentElement.dataset.theme = theme;
    if (params.get("theme") && window === window.top) localStorage.setItem("mu-theme", theme);
    if (body.dataset.bare !== undefined) return;

    const active = body.dataset.page;
    const nav = NAV.map((n) => {
      if (n.group) return `<div class="sb-label">${n.group}</div>`;
      const meta = n.plus ? `<span class="plus">PLUS</span>` : n.meta ? `<span class="meta">${n.meta}</span>` : "";
      return `<a class="sb-item ${n.id === active ? "active" : ""}" style="--item-color:${n.c}" href="${n.file}"><i data-lucide="${n.icon}"></i><span>${n.label}</span>${meta}</a>`;
    }).join("");

    const crumbs = (body.dataset.crumbs || body.dataset.title || "").split("/").map((c, i, a) =>
      i === a.length - 1 ? `<h1>${c.trim()}</h1>` : `<span class="muted sm">${c.trim()}</span><span class="sep">/</span>`).join("");
    const subtitle = body.dataset.subtitle ? `<span class="xs muted">${body.dataset.subtitle}</span>` : "";
    const actions = $("#actions") ? $("#actions").innerHTML : "";

    const app = el("div", { class: "app" });
    app.innerHTML = `
      <aside class="sidebar">
        <div class="sb-head"><div class="logo"><i data-lucide="wifi"></i></div><span class="b" style="font-size:14px;letter-spacing:-0.01em">Mesh UI</span>
          <a href="index.html" class="xxs muted-2 ml-auto" title="All mockups">mockups</a></div>
        <div class="sb-net"><span class="dot"></span><div class="grow"><div class="sm m trunc">Maple Street</div><div class="xxs muted">Online · 1.2 Gbps fiber</div></div><i data-lucide="chevrons-up-down" style="width:14px;height:14px;color:var(--muted)"></i></div>
        <nav class="sb-scroll">${nav}</nav>
        <div class="sb-foot"><div class="sb-user"><div class="avatar" style="--c:var(--s-orange);width:26px;height:26px;font-size:11px">AK</div><div class="grow"><div class="sm m trunc">Alex Kim</div><div class="xxs muted">Owner</div></div><i data-lucide="log-out" style="width:14px;height:14px;color:var(--muted)"></i></div></div>
      </aside>
      <section class="main">
        <header class="topbar">
          <div class="crumbs">${crumbs}${subtitle}</div>
          <div class="top-actions">
            ${actions}
            <div class="search" style="margin-left:8px"><i data-lucide="search"></i><span>Search or run a command</span><span class="kbd">Ctrl K</span></div>
            <button class="iconbtn" title="Notifications" style="position:relative"><i data-lucide="bell"></i><span style="position:absolute;top:6px;right:7px;width:7px;height:7px;border-radius:99px;background:var(--s-red);box-shadow:0 0 0 2px var(--bg)"></span></button>
            <button class="iconbtn" id="mu-theme" title="Toggle theme"><i data-lucide="${theme === "dark" ? "sun" : "moon"}"></i></button>
            <div class="winctl"><i data-lucide="minus"></i><i data-lucide="square"></i><i data-lucide="x"></i></div>
          </div>
        </header>
        <div class="content"></div>
      </section>`;
    $("#actions")?.remove();
    app.querySelector(".content").appendChild(page);
    const overlay = $("#overlay");
    body.prepend(app);
    if (overlay) body.appendChild(overlay);
    $("#mu-theme").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      localStorage.setItem("mu-theme", next);
      location.href = location.pathname;
    });
  }

  // Fake QR code (shape only, not scannable). Drawn at an exact pixel size so
  // every module lands on whole pixels: N modules of `cell` px, each a solid
  // square `cell - 1` px wide, light on the surface (inverted, theme-coloured).
  function qr(target, seed, o = {}) {
    const host = $(target);
    if (!host) return;
    const N = 29, cell = o.cell ?? 4, dot = cell - 1, size = N * cell, r = rng(seed);
    const m = Array.from({ length: N }, () => Array.from({ length: N }, () => r() < 0.47));
    const finder = (x0, y0) => { for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) { const X = x0 + x, Y = y0 + y; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      const ring = x === 0 || x === 6 || y === 0 || y === 6, core = x >= 2 && x <= 4 && y >= 2 && y <= 4; m[Y][X] = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (ring || core); } };
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    for (let i = 8; i < N - 8; i++) { m[6][i] = i % 2 === 0; m[i][6] = i % 2 === 0; }
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) m[22 + y][22 + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1;
    const c = Math.floor(N / 2);
    for (let y = c - 3; y <= c + 3; y++) for (let x = c - 3; x <= c + 3; x++) m[y][x] = false;
    // Finder squares are drawn solid (a ring plus a core) so the corners read cleanly.
    const inFinder = (x, y) => (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
    let rects = "";
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y][x] && !inFinder(x, y)) rects += `<rect x="${x * cell}" y="${y * cell}" width="${dot}" height="${dot}"/>`;
    for (const [fx, fy] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
      const X = fx * cell, Y = fy * cell, W = 7 * cell - 1;
      rects += `<path fill-rule="evenodd" d="M${X} ${Y}h${W}v${W}h-${W}z M${X + cell} ${Y + cell}v${W - 2 * cell}h${W - 2 * cell}v-${W - 2 * cell}z"/>`;
      rects += `<rect x="${X + 2 * cell}" y="${Y + 2 * cell}" width="${3 * cell - 1}" height="${3 * cell - 1}"/>`;
    }
    const lo = (c - 2) * cell, ls = 5 * cell - 1;
    host.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="${o.label ?? "QR code"}">
      <g fill="var(--fg)">${rects}</g><rect x="${lo}" y="${lo}" width="${ls}" height="${ls}" rx="${cell}" fill="var(--fg)" shape-rendering="geometricPrecision"/></svg>`;
  }

  const readyFns = [];
  function ready(fn) { readyFns.push(fn); }

  function boot() {
    shell();
    readyFns.forEach((f) => f());
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.9 } });
  }

  // Load lucide icons, then boot.
  const s = document.createElement("script");
  s.src = "https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js";
  s.onload = () => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot());
  s.onerror = s.onload;
  document.head.appendChild(s);
  const f = document.createElement("link");
  f.rel = "stylesheet";
  f.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;650;700&display=swap";
  document.head.appendChild(f);

  window.MU = { ready, qr, area, bars, spark, donut, gauge, heat, heatValues, series, rng, fmt, labels, niceScale, NAV };
})();
