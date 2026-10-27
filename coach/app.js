/* Løpecoach-dashboard. Leser data.json (generert av pipelinen). */
const $ = (s) => document.querySelector(s);
const C = { low: "#3fb950", high: "#d29922", ana: "#f85149", acc: "#58a6ff", muted: "#8b98a5", line: "#2a3542", fg: "#e6edf3" };
const DAYN = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const STATUS = { completed: "✓ gjennomført", partial: "◐ delvis", missed: "✗ ikke gjort", extra: "+ ekstra", rest: "hvile" };
const charts = {};
let D, range = { trends: 90, load: 180 };
let todaySessionView = { target: "speed", environment: null };

const fmtDate = (s) => { const d = new Date(s + "T12:00"); return `${DAYN[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}`; };
const fmtSec = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0"); };
const fmtPace = (minPerKm) => minPerKm ? fmtSec(minPerKm * 60) : "–";
const last = (arr, key) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] != null) return arr[i][key]; return null; };
const avg = (a) => { a = a.filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
const since = (rows, days, key = "date") => { const t = new Date(); t.setDate(t.getDate() - days); const s = t.toISOString().slice(0, 10); return rows.filter((r) => r[key] >= s); };
const roll = (arr, n) => arr.map((_, i) => avg(arr.slice(Math.max(0, i - n + 1), i + 1)));

function chart(id, opt) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id] && charts[id].getDom() !== el) { charts[id].dispose(); delete charts[id]; }
  if (!charts[id]) charts[id] = echarts.init(el, "dark", { renderer: "canvas" });
  charts[id].setOption(Object.assign({
    backgroundColor: "transparent", animation: false,
    grid: { left: 44, right: 44, top: 30, bottom: 30 },
    tooltip: { trigger: "axis" },
    textStyle: { fontFamily: "system-ui" },
  }, opt), true);
}

function tabs() {
  document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#tabs button, .tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); $("#" + b.dataset.tab).classList.add("active");
    location.hash = b.dataset.tab;
    render(b.dataset.tab);
  });
  document.querySelectorAll(".range").forEach((el) => {
    const k = el.dataset.for;
    el.innerHTML = [[30, "30 d"], [90, "3 mnd"], [180, "6 mnd"], [365, "1 år"], [5000, "Alt"]]
      .map(([d, l]) => `<button data-d="${d}" class="${d === range[k] ? "active" : ""}">${l}</button>`).join("");
    el.querySelectorAll("button").forEach((b) => b.onclick = () => {
      range[k] = +b.dataset.d; el.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b)); render(k);
    });
  });
  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
}

/* ---------- I dag ---------- */
function stepHtml(st, view = null, session = null) {
  let tgt = st.kmh != null ? `<span class="kmh">${st.kmh} km/t</span>${st.incline ? ` @ ${st.incline}%` : ""} <span class="muted">(${st.pace || ""})</span>` : (st.pace || "");
  if (view?.target === "heart") {
    const easy = /Oppvarming|Nedjogg|Jevnt rolig/.test(st.label);
    const low = D.zones?.zone2Floor, high = D.zones?.zone3Floor;
    tgt = easy ? (low != null && high != null ? `${low}–${high - 1} bpm · sone 2` : "Rolig og pratbart")
      : (session?.hr_target || "Styr etter kontrollert innsats; pulsmål mangler");
  } else if (view?.environment === "outdoor") {
    tgt = st.pace ? `<span class="kmh">${st.pace}</span>` : "Styr etter innsats i terrenget";
  } else if (view?.environment === "treadmill") {
    let kmh = st.kmh, incline = st.incline ?? 1;
    if (kmh == null && st.sec_per_km > 0) {
      const speed = 3600 / st.sec_per_km * (D.analytics.treadmill_factor || 1);
      kmh = Math.min(16, Math.round(speed * 2) / 2);
      if (speed > 16.25) incline += Math.ceil((speed - 16) / 0.4);
    }
    tgt = kmh != null ? `<span class="kmh">${kmh.toLocaleString("nb-NO")} km/t</span> @ ${incline}%` : "Styr etter kontrollert innsats";
  }
  const extra = [st.work && `${st.work} drag`, st.rest && `pause ${st.rest}`, st.set_rest].filter(Boolean).join(", ");
  return `<li><b>${st.label}</b>${st.minutes ? ` (${st.minutes} min)` : ""}: ${tgt}${extra ? `<br><span class="muted">${extra}</span>` : ""}${st.note ? `<div class="note">${st.note}</div>` : ""}</li>`;
}
function sessionHtml(s, full = true, view = null) {
  if (!s) return "<p class='muted'>Ingen økt planlagt.</p>";
  const cls = { low: "b-low", high: "b-high", ana: "b-ana", rest: "b-rest" }[s.intensity] || "b-rest";
  const lbl = { low: "Lav aerob", high: "Høy aerob", ana: "Anaerob", rest: "Hvile" }[s.intensity] || "";
  const treadmill = view ? view.environment === "treadmill" : s.treadmill;
  let h = `<h3>${s.title} ${s.minutes ? `· ${s.minutes} min` : ""} <span class="badge ${cls}">${lbl}</span>${treadmill && s.minutes ? " 🏠 mølle" : ""}</h3>`;
  if (s.original) h += `<div class="note">Opprinnelig: ${s.original.title} (${s.original.minutes} min)</div>`;
  for (const k of ["coach_note", "readiness_note"]) if (s[k]) h += `<div class="note">${s[k]}</div>`;
  const description = view?.environment === "outdoor" ? (s.description || "").replace(" På mølla: hopp av til sidekantene i pausene.", "") : s.description;
  h += `<p>${description || ""}</p>`;
  if (full && s.steps?.length) h += `<ul class="steps">${s.steps.map((st) => stepHtml(st, view, s)).join("")}</ul>`;
  if (view?.target === "heart" && s.type === "intervals_45_15") h += `<p class="note">Pulsen reagerer forsinket på 45-sekundersdrag. Ikke øk farten for å jage pulsmålet; hold jevn, kontrollert innsats.</p>`;
  if (s.hr_target) h += `<p class="muted">❤️ Puls: ${s.hr_target}</p>`;
  if (s.note && !s.note.startsWith("Mølle (kan gjerne tas ute")) h += `<p class="muted">${s.note}</p>`;
  if (s.optional && s.type === "rest") h += `<p class="muted">Valgfritt: ${s.optional}</p>`;
  return h;
}

function renderTodaySession() {
  const today = D.analytics.today, s = D.plan.days?.[today];
  const view = { ...todaySessionView, environment: todaySessionView.environment || (s?.treadmill ? "treadmill" : "outdoor") };
  const controls = s?.minutes > 0 ? `<div class="session-controls">
    <label>Styr økten etter<select id="session-target"><option value="speed"${view.target === "speed" ? " selected" : ""}>Fart</option><option value="heart"${view.target === "heart" ? " selected" : ""}>Puls</option></select></label>
    <label>Hvor løper du?<select id="session-environment"><option value="treadmill"${view.environment === "treadmill" ? " selected" : ""}>Mølle · km/t</option><option value="outdoor"${view.environment === "outdoor" ? " selected" : ""}>Utendørs · min/km</option></select></label>
    </div>` : "";
  $("#today-session").innerHTML = controls + `<div class="muted">${fmtDate(today)}</div>` + sessionHtml(s, true, view);
  if (!controls) return;
  $("#session-target").onchange = (e) => { todaySessionView.target = e.target.value; renderTodaySession(); };
  $("#session-environment").onchange = (e) => { todaySessionView.environment = e.target.value; renderTodaySession(); };
}

function todayMessage(data) {
  const { today, readiness: r } = data.analytics;
  const session = data.plan.days?.[today];
  const current = data.daily.find((d) => d.date === today);
  const previousDate = new Date(today + "T12:00:00Z");
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const yesterday = previousDate.toISOString().slice(0, 10);
  const previous = data.daily.find((d) => d.date === yesterday);
  const previousRuns = data.runs.filter((run) => run.date.slice(0, 10) === yesterday);
  const todayRuns = data.runs.filter((run) => run.date.slice(0, 10) === today);
  const history = data.plan.history?.[yesterday];
  let context;
  if (previousRuns.length || previous?.km > 0) {
    const km = previous?.km ?? previousRuns.reduce((sum, run) => sum + (run.km || 0), 0);
    context = `Du løp ${km.toFixed(1)} km i går.`;
  } else if (history?.status === "rest" || (previous?.km === 0 && data.plan.days?.[yesterday]?.type === "rest")) {
    context = "Hviledag fra løping i går.";
  } else if (previous?.km === 0) {
    context = "Ingen løpeøkt registrert i går.";
  } else {
    context = "Gårsdagens treningsdata mangler.";
  }
  if (todayRuns.length || current?.km > 0) return `${context} Dagens løpeøkt er registrert. Prioriter restitusjon nå; planen vurderes ved kveldssynken.`;
  if (r.level === "red") return `${context} Lav readiness i dag: prioriter hvile eller lett restitusjon fremfor en hard økt.`;
  if (r.level === "unknown" || r.score == null) return `${context} Synk klokka før du vurderer dagens intensitet – readiness mangler.`;
  if (!session) return `${context} Ingen økt er planlagt i dag. Se planen før du velger økt.`;
  if (session.type === "rest") return `${context} I dag er også planlagt som hviledag; ikke legg inn en hard økt for å ta igjen trening.`;
  if (session.locked && !session.minutes) return `${context} ${session.title} er lagt inn i planen i dag.`;
  const recommendation = `${session.title.toLowerCase()}${session.minutes ? ` (${session.minutes} min)` : ""}`;
  if (r.level === "yellow") return `${context} Gult lys: ta en forsiktig start på ${recommendation}, og reduser hvis kroppen kjennes tung.`;
  return `${context} Readiness ${r.score}/100 gir grønt lys: få inn ${recommendation} i dag. Kjenn etter under oppvarmingen.`;
}

function renderToday() {
  const a = D.analytics, r = a.readiness, today = a.today;
  const col = { green: C.low, yellow: C.high, red: C.ana }[r.level] || C.muted;
  const observed = D.daily.find((d) => d.date === today) || {};
  const metric = (label, value, unit = "") => `<div><dt>${label}</dt><dd>${value == null ? "–" : `${Math.round(value)}${unit ? ` <small>${unit}</small>` : ""}`}</dd></div>`;
  $("#readiness-card").innerHTML = `<h3>Readiness i dag</h3><div class="readiness-overview">
    <div id="g-ready" class="gauge" role="img" aria-label="Readiness ${r.score ?? "ukjent"} av 100"></div>
    <dl class="readiness-values" aria-label="Dagens målte verdier">
      ${metric("HRV i natt", observed.hrv, "ms")}
      ${metric("Hvilepuls", observed.rhr, "bpm")}
      ${metric("Søvnscore", observed.sleep, "/100")}
      ${metric("Body Battery", observed.bb_max, "/100")}
      ${metric("Form (TSB)", observed.tsb)}
    </dl></div><div class="today-message"><h3>Dagens melding</h3><p></p></div>
    <div>${(r.notes || []).map((n) => `<div class="note">${n}</div>`).join("")}</div>`;
  $("#readiness-card .today-message p").textContent = todayMessage(D);
  chart("g-ready", {
    series: [{ type: "gauge", startAngle: 200, endAngle: -20, min: 0, max: 100, radius: "90%", center: ["50%", "55%"],
      progress: { show: true, width: 10, itemStyle: { color: col } }, axisLine: { lineStyle: { width: 10, color: [[1, C.line]] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
      detail: { valueAnimation: false, fontSize: 34, offsetCenter: [0, "0%"], color: col, formatter: (v) => v == null ? "–" : v },
      title: { offsetCenter: [0, "40%"], color: C.muted, fontSize: 12 },
      data: [{ value: r.score, name: "av 100" }] }],
  });
  renderTodaySession();

  const d = D.daily, n = d.length;
  const kp = (l, v, unit, base, better = 1, dec = 0) => {
    const diff = v != null && base != null ? v - base : null;
    const cls = diff == null || Math.abs(diff) < 0.5 ? "" : diff * better > 0 ? "up" : "down";
    return `<div class="card kpi"><div class="l">${l}</div><div class="v">${v == null ? "–" : v.toFixed(dec)}<small> ${unit}</small></div>
      <div class="d ${cls}">${diff == null ? "" : (diff > 0 ? "+" : "") + diff.toFixed(dec) + " vs. 30 d snitt"}</div></div>`;
  };
  const b30 = (k) => avg(d.slice(n - 31, n - 1).map((x) => x[k]));
  $("#kpis").innerHTML = [
    kp("HRV i natt", last(d, "hrv"), "ms", b30("hrv"), 1),
    kp("Hvilepuls", last(d, "rhr"), "bpm", b30("rhr"), -1),
    kp("Søvnscore", last(d, "sleep"), "", b30("sleep"), 1),
    kp("Body Battery topp", last(d, "bb_max"), "", b30("bb_max"), 1),
    kp("Kondisjon (CTL)", last(d, "ctl"), "", d[Math.max(0, n - 29)]?.ctl, 1),
    kp("Form (TSB)", last(d, "tsb"), "", null),
    `<div class="card kpi"><div class="l">VDOT / VO2-est.</div><div class="v">${a.vdot.vdot}</div><div class="d muted">10k ≈ ${a.predictions["10k"]}</div></div>`,
    `<div class="card kpi"><div class="l">Km siste 7 d</div><div class="v">${since(d, 7).reduce((s, x) => s + (x.km || 0), 0).toFixed(1)}</div><div class="d muted">4 uker: ${since(d, 28).reduce((s, x) => s + (x.km || 0), 0).toFixed(0)} km</div></div>`,
  ].join("");
  const al = a.alerts || [];
  $("#alerts").innerHTML = `<h3>Varsler</h3>` + (al.length ? al.map((x) => `<div class="alert ${x.level}">${x.text}</div>`).join("") : "<span class='muted'>Ingen varsler 👍</span>");
  const m = since(d, 14);
  chart("c-mini", {
    legend: { top: 0, textStyle: { color: C.muted } }, grid: { left: 36, right: 36, top: 30, bottom: 24 },
    xAxis: { type: "category", data: m.map((x) => x.date.slice(5)) },
    yAxis: [{ type: "value", name: "", splitLine: { lineStyle: { color: C.line } } }, { type: "value", splitLine: { show: false } }],
    series: [
      { name: "Belastning", type: "bar", data: m.map((x) => x.load), itemStyle: { color: "#30363d" }, yAxisIndex: 1 },
      { name: "HRV", type: "line", data: m.map((x) => x.hrv), color: C.acc, smooth: true },
      { name: "Søvn", type: "line", data: m.map((x) => x.sleep), color: "#a371f7", smooth: true },
      { name: "Hvilepuls", type: "line", data: m.map((x) => x.rhr), color: C.ana, smooth: true },
    ],
  });
}

/* ---------- Plan ---------- */
function renderPlan() {
  const p = D.plan, today = D.analytics.today, days = p.days || {}, hist = p.history || {};
  const t = p.target;
  const pb = p.planned_balance || {}, ab = D.analytics.balance || {};
  const bar = (b) => `<div class="bar" style="display:flex"><div style="width:${(b.low || 0) * 100}%;background:${C.low}"></div><div style="width:${(b.high || 0) * 100}%;background:${C.high}"></div><div style="width:${(b.ana || 0) * 100}%;background:${C.ana}"></div></div>`;
  $("#plan-head").innerHTML = `<h3>${t ? `Mål: ${t.name} (${t.distance_km} km) ${t.date}${t.goal_time ? " – " + t.goal_time : ""}` : "Mål: generell form – raskere og lenger"}</h3>
    <p class="muted">${(p.weeks || [])[0]?.phase_text || ""}${p.end_date ? ` · Plan til ${p.end_date}` : ""} · VDOT ${p.vdot}</p>
    <div class="row" style="display:block"><div class="muted">Siste 4 uker (faktisk): lav ${Math.round(ab.low * 100)}% · høy ${Math.round(ab.high * 100)}% · anaerob ${Math.round(ab.ana * 100)}%</div>${bar(ab)}
    <div class="muted" style="margin-top:6px">Neste 4 uker (plan): lav ${Math.round(pb.low * 100)}% · høy ${Math.round(pb.high * 100)}% · anaerob ${Math.round(pb.ana * 100)}%</div>${bar(pb)}</div>`;
  const keys = Object.keys(days).sort();
  const start = new Date(today + "T12:00"); start.setDate(start.getDate() - 14);
  const s0 = start.toISOString().slice(0, 10);
  const byWeek = {};
  for (const k of keys.filter((k) => k >= s0)) {
    const d = new Date(k + "T12:00"); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    (byWeek[mon.toISOString().slice(0, 10)] ||= []).push(k);
  }
  const wmeta = Object.fromEntries((p.weeks || []).map((w) => [w.monday, w]));
  $("#plan-weeks").innerHTML = Object.entries(byWeek).map(([mon, ks]) => {
    const w = wmeta[mon];
    const tot = ks.reduce((s, k) => s + (days[k].minutes || 0), 0);
    return `<div class="card week"><h4><span>Uke fra ${fmtDate(mon)}${w?.deload ? " · 🔋 avlastningsuke" : ""}</span><span class="muted">${tot} min planlagt</span></h4>` +
      ks.map((k) => {
        const s = days[k], h = hist[k];
        const cls = { low: "b-low", high: "b-high", ana: "b-ana" }[s.intensity] || "b-rest";
        return `<div class="day ${k === today ? "today" : ""} ${k < today ? "past" : ""}" data-k="${k}">
          <span class="dt">${fmtDate(k)}</span>
          <span><span class="badge ${cls}">&nbsp;</span> ${s.title}${s.minutes ? ` · ${s.minutes} min` : ""}${s.locked ? " 🔒" : ""}${s.coach_note ? " 💬" : ""}</span>
          <span class="st ${h ? "st-" + h.status : ""}">${h ? STATUS[h.status] + (h.actual ? ` ${h.actual.km} km` : "") : s.treadmill && s.minutes ? "🏠" : ""}</span></div>
          <div class="day-detail" id="dd-${k}">${sessionHtml(s)}</div>`;
      }).join("") + "</div>";
  }).join("");
  document.querySelectorAll(".day").forEach((el) => el.onclick = () => $("#dd-" + el.dataset.k).classList.toggle("open"));
  const pn = { easy_slow: "Rolig (nedre)", easy_fast: "Rolig (øvre)", marathon: "Maraton", threshold: "Terskel", "10k": "10 km", "5k": "5 km", "3k": "3 km", "1500": "1500 m" };
  $("#paces").innerHTML = `<table><tr><th>Sone</th><th>Fart</th><th>Mølle</th></tr>${Object.entries(p.paces || {}).map(([k, v]) => {
    const [m, s] = v.replace("/km", "").split(":").map(Number); const kmh = 3600 / (m * 60 + s) * (D.analytics.treadmill_factor || 1);
    const r = Math.round(kmh * 2) / 2;
    return `<tr><td>${pn[k] || k}</td><td>${v}</td><td>${r > 16 ? `16 km/t + ${Math.ceil((kmh - 16) / 0.4) + 1}%` : r + " km/t"}</td></tr>`;
  }).join("")}</table><p class="muted">Rolige turer styres primært på puls (sone 2).${Math.abs((D.analytics.treadmill_factor || 1) - 1) >= 0.01 ? ` Møllefart justert ${Math.round(((D.analytics.treadmill_factor) - 1) * 100)} % ut fra dine kalibrerte mølleturer.` : ""}</p>`;
  $("#log").innerHTML = (p.log || []).slice().reverse().slice(0, 60).map((l) => `<li><span class="muted">${l.date} · ${l.kind}</span><br>${l.text}</li>`).join("") || "<li class='muted'>Ingen endringer ennå</li>";
}

/* ---------- Helse ---------- */
function renderTrends() {
  const d = since(D.daily, range.trends), x = d.map((r) => r.date);
  const xa = { type: "category", data: x, axisLabel: { formatter: (v) => v.slice(5) } };
  const ya = (o = {}) => Object.assign({ type: "value", scale: true, splitLine: { lineStyle: { color: C.line } } }, o);
  chart("c-hrv", { xAxis: xa, yAxis: ya(), legend: { top: 0 }, dataZoom: [{ type: "inside" }], series: [
    { name: "Normal nedre", type: "line", data: d.map((r) => r.hrv_lo), lineStyle: { opacity: 0 }, stack: "b", symbol: "none" },
    { name: "Normalområde", type: "line", data: d.map((r) => r.hrv_hi != null && r.hrv_lo != null ? r.hrv_hi - r.hrv_lo : null), lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(63,185,80,.18)" }, stack: "b", symbol: "none" },
    { name: "HRV i natt", type: "scatter", data: d.map((r) => r.hrv), symbolSize: 5, color: C.acc },
    { name: "7-d snitt", type: "line", data: d.map((r) => r.hrv7), color: C.acc, symbol: "none", smooth: true },
  ] });
  chart("c-rhr", { xAxis: xa, yAxis: ya(), dataZoom: [{ type: "inside" }], series: [
    { name: "Hvilepuls", type: "line", data: d.map((r) => r.rhr), color: C.ana, symbol: "none" },
    { name: "7-d snitt", type: "line", data: roll(d.map((r) => r.rhr), 7), color: "#ffa198", symbol: "none", smooth: true, lineStyle: { width: 3 } },
  ] });
  chart("c-sleep", { xAxis: xa, yAxis: [ya({ name: "score", max: 100 }), ya({ name: "timer", splitLine: { show: false } })], legend: { top: 0 }, dataZoom: [{ type: "inside" }], series: [
    { name: "Søvntimer", type: "bar", yAxisIndex: 1, data: d.map((r) => r.sleep_h && +r.sleep_h.toFixed(1)), itemStyle: { color: "#2d2a4a" } },
    { name: "Søvnscore", type: "line", data: d.map((r) => r.sleep), color: "#a371f7", symbol: "none" },
    { name: "7-d snitt", type: "line", data: roll(d.map((r) => r.sleep), 7), color: "#d2a8ff", symbol: "none", smooth: true, lineStyle: { width: 3 } },
  ] });
  chart("c-bb", { xAxis: xa, yAxis: ya({ min: 0, max: 100 }), dataZoom: [{ type: "inside" }], series: [
    { name: "Bunn", type: "line", data: d.map((r) => r.bb_min), stack: "bb", lineStyle: { opacity: 0 }, symbol: "none" },
    { name: "Topp", type: "line", data: d.map((r) => r.bb_max != null && r.bb_min != null ? r.bb_max - r.bb_min : null), stack: "bb", areaStyle: { color: "rgba(88,166,255,.35)" }, lineStyle: { opacity: 0 }, symbol: "none",
      tooltip: { valueFormatter: (v) => v } },
    { name: "Topp (verdi)", type: "line", data: d.map((r) => r.bb_max), color: C.acc, symbol: "none" },
  ] });
  // kalender: HRV relativt til normalområdet
  const all = since(D.daily, 365);
  const val = all.map((r) => [r.date, r.hrv != null && r.hrv_lo != null ? +(((r.hrv - (r.hrv_lo + r.hrv_hi) / 2) / Math.max((r.hrv_hi - r.hrv_lo) / 2, 1))).toFixed(2) : null]);
  const y = new Date().getFullYear();
  chart("c-cal", {
    tooltip: { formatter: (p) => `${p.value[0]}: ${p.value[1] == null ? "–" : p.value[1] > 0 ? "over normal" : p.value[1] < -1 ? "under normal" : "normal"}` },
    visualMap: { min: -2, max: 2, show: false, inRange: { color: [C.ana, C.high, "#2ea043", "#56d364"] } },
    calendar: [{ range: [all[0]?.date, all[all.length - 1]?.date], cellSize: ["auto", 13], top: 30, left: 30, right: 10, orient: "horizontal",
      itemStyle: { color: "#161b22", borderColor: "#0f1419" }, splitLine: { show: false }, yearLabel: { show: false }, dayLabel: { firstDay: 1, nameMap: ["S", "M", "T", "O", "T", "F", "L"], color: C.muted }, monthLabel: { color: C.muted, nameMap: ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"] } }],
    series: [{ type: "heatmap", coordinateSystem: "calendar", data: val.filter((v) => v[1] != null) }],
  });
}

/* ---------- Belastning ---------- */
function renderLoad() {
  const d = since(D.daily, range.load), x = d.map((r) => r.date);
  chart("c-pmc", { legend: { top: 0 }, xAxis: { type: "category", data: x, axisLabel: { formatter: (v) => v.slice(5) } },
    yAxis: [{ type: "value", splitLine: { lineStyle: { color: C.line } } }, { type: "value", splitLine: { show: false } }], dataZoom: [{ type: "inside" }],
    series: [
      { name: "Daglig belastning", type: "bar", data: d.map((r) => r.load || null), itemStyle: { color: "#30363d" }, yAxisIndex: 1 },
      { name: "Kondisjon (CTL)", type: "line", data: d.map((r) => r.ctl), color: C.acc, symbol: "none", lineStyle: { width: 3 } },
      { name: "Tretthet (ATL)", type: "line", data: d.map((r) => r.atl), color: "#db61a2", symbol: "none" },
      { name: "Form (TSB)", type: "line", data: d.map((r) => r.tsb), color: C.high, symbol: "none", areaStyle: { opacity: 0.12 } },
    ] });
  const w = since(D.weekly, range.load, "week");
  chart("c-week", { legend: { top: 0 }, xAxis: { type: "category", data: w.map((r) => r.week.slice(5)) },
    yAxis: [{ type: "value", splitLine: { lineStyle: { color: C.line } } }, { type: "value", name: "km", splitLine: { show: false } }],
    series: [
      { name: "Lav aerob", type: "bar", stack: "l", data: w.map((r) => r.load_low), color: C.low },
      { name: "Høy aerob", type: "bar", stack: "l", data: w.map((r) => r.load_high), color: C.high },
      { name: "Anaerob", type: "bar", stack: "l", data: w.map((r) => r.load_ana), color: C.ana },
      { name: "Km", type: "line", yAxisIndex: 1, data: w.map((r) => r.run_km), color: C.fg, symbol: "circle" },
    ] });
  const b = D.analytics.balance, pb = D.plan.planned_balance || {};
  const tg = { low: [55, 75], high: [20, 35], ana: [5, 15] };
  chart("c-balance", { grid: { left: 90, right: 20, top: 20, bottom: 20 }, legend: { top: 0 }, tooltip: { trigger: "axis", valueFormatter: (v) => v + "%" },
    yAxis: { type: "category", data: ["Anaerob", "Høy aerob", "Lav aerob"] }, xAxis: { type: "value", max: 100, splitLine: { lineStyle: { color: C.line } } },
    series: [
      { name: "Siste 4 uker", type: "bar", data: [b.ana, b.high, b.low].map((v) => Math.round(v * 100)), itemStyle: { color: (p) => [C.ana, C.high, C.low][p.dataIndex] },
        markArea: { itemStyle: { color: "rgba(255,255,255,.07)" }, data: [["ana", 0], ["high", 1], ["low", 2]].map(([k, i]) => [{ yAxis: i, xAxis: tg[k][0] }, { yAxis: i, xAxis: tg[k][1] }]) } },
      { name: "Plan neste 4 uker", type: "bar", data: [pb.ana, pb.high, pb.low].map((v) => Math.round((v || 0) * 100)), itemStyle: { color: "#6e7681" } },
    ] });
  chart("c-acwr", { xAxis: { type: "category", data: x, axisLabel: { formatter: (v) => v.slice(5) } }, yAxis: { type: "value", min: 0, max: 2.2, splitLine: { lineStyle: { color: C.line } } },
    visualMap: { show: false, pieces: [{ lt: 0.8, color: C.muted }, { gte: 0.8, lte: 1.3, color: C.low }, { gt: 1.3, lte: 1.5, color: C.high }, { gt: 1.5, color: C.ana }] },
    series: [{ type: "line", data: d.map((r) => r.acwr && +r.acwr.toFixed(2)), symbol: "none", markArea: { itemStyle: { color: "rgba(63,185,80,.08)" }, data: [[{ yAxis: 0.8 }, { yAxis: 1.3 }]] } }] });
}

/* ---------- Sammenhenger ---------- */
const VARS = { hrv: "HRV", rhr: "Hvilepuls", sleep: "Søvnscore", sleep_h: "Søvntimer", bb_max: "Body Battery topp", stress: "Stress", load: "Belastning", km: "Km løpt", tsb: "Form (TSB)", ctl: "Kondisjon (CTL)" };
function renderCorr() {
  const c = D.analytics.correlations || {};
  $("#insights").innerHTML = (c.insights || []).map((i) => `<li>${i.text}</li>`).join("") || "<li class='muted'>For lite data ennå.</li>";
  if (c.matrix) {
    const data = []; c.matrix.forEach((row, i) => row.forEach((v, j) => data.push([j, i, v])));
    chart("c-heat", { tooltip: { formatter: (p) => `${c.labels[p.value[1]]} ↔ ${c.labels[p.value[0]]}: ${p.value[2]}` }, grid: { left: 150, right: 20, top: 10, bottom: 110 },
      xAxis: { type: "category", data: c.labels, axisLabel: { rotate: 45, interval: 0 } }, yAxis: { type: "category", data: c.labels, axisLabel: { interval: 0 } },
      visualMap: { min: -1, max: 1, calculable: false, orient: "horizontal", left: "center", bottom: 0, inRange: { color: [C.ana, "#161b22", C.acc] }, textStyle: { color: C.muted } },
      series: [{ type: "heatmap", data, label: { show: true, fontSize: 10, formatter: (p) => p.value[2] == null ? "" : p.value[2].toFixed(1) } }] });
  }
  const sx = $("#sx"), sy = $("#sy");
  if (!sx.options.length) {
    for (const [k, v] of Object.entries(VARS)) { sx.add(new Option(v, k)); sy.add(new Option(v, k)); }
    sx.value = "sleep"; sy.value = "hrv"; $("#slag").checked = true;
    [sx, sy, $("#slag")].forEach((e) => e.onchange = renderCorr);
  }
  const d = since(D.daily, 365), lag = $("#slag").checked ? 1 : 0;
  const pts = []; for (let i = 0; i + lag < d.length; i++) { const a = d[i][sx.value], b = d[i + lag][sy.value]; if (a != null && b != null) pts.push([a, b, d[i].date]); }
  const n = pts.length, mx = avg(pts.map((p) => p[0])), my = avg(pts.map((p) => p[1]));
  let sxy = 0, sxx = 0; pts.forEach(([a, b]) => { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; });
  const k = sxx ? sxy / sxx : 0, xs = pts.map((p) => p[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
  chart("c-scatter", { tooltip: { trigger: "item", formatter: (p) => p.value[2] ? `${p.value[2]}: ${p.value[0]} → ${p.value[1]}` : "" },
    xAxis: { type: "value", scale: true, name: VARS[sx.value], nameLocation: "middle", nameGap: 24, splitLine: { lineStyle: { color: C.line } } },
    yAxis: { type: "value", scale: true, name: VARS[sy.value] + (lag ? " (neste dag)" : ""), splitLine: { lineStyle: { color: C.line } } },
    series: [{ type: "scatter", data: pts, symbolSize: 6, itemStyle: { color: C.acc, opacity: 0.6 } },
      n > 5 ? { type: "line", data: [[x0, my + k * (x0 - mx)], [x1, my + k * (x1 - mx)]], symbol: "none", color: C.high } : null].filter(Boolean) });
}

/* ---------- Prestasjon ---------- */
function renderPerf() {
  const a = D.analytics;
  const rows = Object.keys(a.predictions).map((k) => `<div class="card kpi"><div class="l">${k} prognose nå</div><div class="v">${a.predictions[k]}</div>
    <div class="d muted">om 8 uker: ${a.predictions_future[k]}</div></div>`);
  rows.push(`<div class="card kpi"><div class="l">VDOT</div><div class="v">${a.vdot.vdot}</div><div class="d muted">trend ${a.forecast.slope_per_month >= 0 ? "+" : ""}${a.forecast.slope_per_month}/mnd</div></div>`);
  $("#pred").innerHTML = rows.join("");
  const d = D.daily.filter((r) => r.vo2 != null || r.vo2_30 != null);
  chart("c-vo2", { legend: { top: 0 }, xAxis: { type: "time" }, yAxis: { type: "value", scale: true, splitLine: { lineStyle: { color: C.line } } }, dataZoom: [{ type: "inside" }],
    series: [
      { name: "Per økt", type: "scatter", data: d.filter((r) => r.vo2).map((r) => [r.date, +r.vo2.toFixed(1)]), symbolSize: 5, color: "#6e7681" },
      { name: "30-d median", type: "line", data: d.filter((r) => r.vo2_30).map((r) => [r.date, +r.vo2_30.toFixed(1)]), color: C.acc, symbol: "none", lineStyle: { width: 3 } },
      { name: "Løpsresultat (VDOT)", type: "scatter", data: (D.pbs_all || []).map((p) => [p.date, p.vdot]), color: C.high },
    ] });
  const easy = D.runs.filter((r) => ["AEROBIC_BASE", "RECOVERY"].includes(r.label) && r.ef);
  const efs = easy.map((r) => r.ef);
  chart("c-ef", { legend: { top: 0 }, xAxis: { type: "time" }, yAxis: { type: "value", scale: true, splitLine: { lineStyle: { color: C.line } } }, dataZoom: [{ type: "inside" }],
    series: [
      { name: "Ute", type: "scatter", data: easy.filter((r) => !r.treadmill).map((r) => [r.date.slice(0, 10), r.ef]), symbolSize: 6, color: C.low },
      { name: "Mølle", type: "scatter", data: easy.filter((r) => r.treadmill).map((r) => [r.date.slice(0, 10), r.ef]), symbolSize: 6, color: "#6e7681" },
      { name: "Trend (10 økter)", type: "line", data: easy.map((r, i) => [r.date.slice(0, 10), +avg(efs.slice(Math.max(0, i - 9), i + 1)).toFixed(3)]), symbol: "none", color: C.acc, lineStyle: { width: 3 } },
    ] });
  const rr = D.runs.filter((r) => r.pace && r.hr && r.pace < 9);
  chart("c-pacehr", { tooltip: { trigger: "item", formatter: (p) => `${p.value[2]}<br>${fmtPace(p.value[0])}/km · ${p.value[1]} bpm` },
    xAxis: { type: "value", inverse: true, scale: true, name: "min/km", axisLabel: { formatter: fmtPace }, splitLine: { lineStyle: { color: C.line } } },
    yAxis: { type: "value", scale: true, name: "puls", splitLine: { lineStyle: { color: C.line } } },
    visualMap: { show: false, dimension: 3, min: 0, max: rr.length, inRange: { color: ["#30363d", C.acc] } },
    series: [{ type: "scatter", symbolSize: 6, data: rr.map((r, i) => [r.pace, r.hr, r.date.slice(0, 10), i]) }] });
  const dyn = D.runs.filter((r) => r.gct || r.cadence);
  const r10 = (k) => dyn.map((r, i) => [r.date.slice(0, 10), +(avg(dyn.slice(Math.max(0, i - 9), i + 1).map((x) => x[k])) || 0).toFixed(1)]);
  chart("c-dyn", { legend: { top: 0 }, xAxis: { type: "time" }, yAxis: [{ type: "value", scale: true, name: "ms / spm", splitLine: { lineStyle: { color: C.line } } }, { type: "value", scale: true, name: "cm", splitLine: { show: false } }],
    dataZoom: [{ type: "inside" }],
    series: [
      { name: "Bakkekontakt (ms)", type: "line", data: r10("gct"), symbol: "none", color: C.ana },
      { name: "Kadens (spm)", type: "line", data: r10("cadence"), symbol: "none", color: C.low },
      { name: "Steglengde (cm)", type: "line", yAxisIndex: 1, data: r10("stride"), symbol: "none", color: C.acc },
    ] });
  $("#pbs").innerHTML = `<table><tr><th>Distanse</th><th>Tid</th><th>Dato</th><th>VDOT</th></tr>${(D.pbs || []).map((p) => `<tr><td>${p.dist}</td><td>${fmtSec(p.seconds)}</td><td>${p.date}</td><td>${p.vdot}</td></tr>`).join("")}</table>
    <p class="muted">Basert på Strava «best efforts» og hele Garmin-økter nær distansen.</p>`;
}

/* ---------- Sko ---------- */
function renderShoes() {
  const sh = D.analytics.shoes || [];
  if (!sh.length) { $("#shoe-list").innerHTML = `<div class="card muted">Ingen skodata ennå. Koble til Strava (se README) for å få sko per økt.</div>`; return; }
  const st = { ok: ["OK", "green"], watch: ["Følg med", "yellow"], replace: ["Bytt snart", "red"], retired: ["Pensjonert", "muted"] };
  $("#shoe-list").innerHTML = `<div class="grid">${sh.map((s) => `<div class="card"><h3>${s.name} <span class="${st[s.status][1]}">● ${st[s.status][0]}</span></h3>
    <div class="bar"><div style="width:${Math.min(100, (s.km / s.replace_km) * 100)}%;background:${s.km > s.replace_km ? C.ana : s.km > s.warn_km ? C.high : C.low}"></div></div>
    <p class="muted">${s.km} km · ${s.runs} økter · ${s.first || ""} → ${s.last || ""}</p>${s.signals.map((x) => `<div class="note">${x}</div>`).join("")}</div>`).join("")}</div>`;
  const active = sh.filter((s) => !s.retired && s.series.length > 5);
  chart("c-shoe", { legend: { top: 0 }, xAxis: { type: "value", name: "km på skoen", nameLocation: "middle", nameGap: 24, splitLine: { lineStyle: { color: C.line } } },
    yAxis: { type: "value", scale: true, name: "bakkekontakt ms", splitLine: { lineStyle: { color: C.line } } },
    series: active.map((s) => ({ name: s.name, type: "line", smooth: true, symbol: "circle", symbolSize: 4, data: s.series.filter((p) => p.gct).map((p) => [p.cum_km, p.gct]) })) });
}

const RENDER = { today: renderToday, plan: renderPlan, trends: renderTrends, load: renderLoad, corr: renderCorr, perf: renderPerf, shoes: renderShoes };
const done = new Set();
function render(t) { try { RENDER[t](); done.add(t); setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 30); } catch (e) { console.error(t, e); } }

fetch("data.json", { cache: "no-store" }).then((r) => r.json()).then((data) => {
  D = data;
  $("#updated").textContent = "Oppdatert " + D.generated.replace("T", " ").slice(0, 16);
  tabs();
  const t = location.hash.slice(1);
  if (t && RENDER[t]) document.querySelector(`#tabs button[data-tab="${t}"]`).click(); else render("today");
});
