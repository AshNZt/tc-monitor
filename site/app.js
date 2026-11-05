/* TermRadar dashboard. Plain JavaScript, no build step.
   Reads data/index.json, data/changes.json and data/changes/<id>.json */
(() => {
  const app = document.getElementById("app");
  const state = { index: null, changes: null, cache: {}, platforms: {} };

  // Change types. Only "substantive" counts as a text change in totals and charts.
  const TYPE_LABEL = {
    substantive: "Text change",
    first: "First record",
    formatting: "Links, formatting or page elements",
    "fetch-error": "Source page error",
    "small-edit": "Small edit",
    reverted: "Reverted to earlier wording",
    temporary: "Short-lived wording",
    "date-only": "Date only",
    technical: "Technical",
  };
  const MINOR = new Set(["formatting", "fetch-error", "small-edit", "reverted", "temporary", "date-only", "technical"]);

  // ---------- helpers ----------
  const skeletonRows = (n) => `<div class="skel-list">${Array.from({ length: n }, () => `<div class="skel-row"><span class="skel w20"></span><span class="skel w50"></span><span class="skel w15"></span></div>`).join("")}</div>`;
  const skeletonPage = () => `<section class="shell page-head" aria-busy="true"><span class="skel w15"></span><span class="skel h1 w50"></span><span class="skel w30"></span></section>
    <section class="shell"><div class="card">${skeletonRows(5)}</div></section>`;
  // fields left out of the data files when empty
  const fillDefaults = (c) => { c.sections ||= []; c.topics ||= []; c.declared_dates ||= []; c.unstable ||= false; return c; };
  // minor changes are in a separate file, loaded on demand
  async function ensureMinor() {
    if (state.minorLoaded) return;
    const minor = (await getJSON("data/changes-minor.json")).map(fillDefaults);
    state.changes = state.changes.concat(minor).sort((a, b) => b.date.localeCompare(a.date));
    state.minorLoaded = true;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso, opts = { day: "numeric", month: "short", year: "numeric" }) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", opts) : "–";
  const short = (iso) => fmtDate(iso, { day: "2-digit", month: "short" });
  const monthKey = (iso) => iso.slice(0, 7);
  const daysAgo = (iso) => (Date.now() - new Date(iso)) / 864e5;
  const enc = encodeURIComponent;
  const P = (id) => state.platforms[id] || { name: id, color: "#8c92a3" };
  const docById = (id) => {
    for (const p of state.index.platforms) for (const d of p.documents) if (d.id === id) return { ...d, platform: p };
    return null;
  };
  const getJSON = async (url) => {
    if (state.cache[url]) return state.cache[url];
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return (state.cache[url] = await r.json());
  };
  const typeTag = (t) => t === "substantive" ? "" : `<span class="type-tag ${t}">${TYPE_LABEL[t] || t}</span>`;
  const diffBadge = (c, cls = "diff feed-diff") => c.type === "first" ? `<span class="${cls}"><span class="muted">new</span></span>` :
    (c.words_changed != null ? `<span class="${cls}"><span class="words">${c.words_changed} word${c.words_changed === 1 ? "" : "s"}</span></span>`
      : `<span class="${cls}"><span class="plus">+${c.added}</span><span class="minus">−${c.removed} lines</span></span>`);
  const lastMonths = (n) => {
    const now = new Date(), keys = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return keys;
  };
  const monthLabel = (k) => new Date(k + "-01").toLocaleDateString("en-GB", { month: "short" }) + " ’" + k.slice(2, 4);

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1800);
  }

  function exportCSV(list, name) {
    const site = location.href.split("#")[0];
    const rows = [["date", "platform", "service", "document", "type", "sections", "lines_added", "lines_removed", "date_stated_in_document", "link"]];
    list.forEach((c) => rows.push([c.date.slice(0, 10), c.platform_name, c.service || "", c.document, TYPE_LABEL[c.type] || c.type,
      c.sections.join("; "), c.added, c.removed, c.declared_dates.join("; "), `${site}#/change/${c.id}`]));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${list.length} changes`);
  }

  const topicLabel = (id) => ((state.index.topics || []).find((t) => t.id === id) || { label: id }).label;
  const topicTags = (c) => (c.topics || []).length ? `<span class="topics">${c.topics.map((t) => `<span class="topic t-${t}">${esc(topicLabel(t))}</span>`).join("")}</span>` : "";

  // Topic chips with counts (last 12 months), linking to the filtered change log
  function topicBrowser(list, extraQuery = "") {
    const recent = list.filter((c) => c.type === "substantive" && daysAgo(c.date) <= 365);
    const n = {};
    recent.forEach((c) => (c.topics || []).forEach((t) => { n[t] = (n[t] || 0) + 1; }));
    const items = (state.index.topics || []).filter((t) => n[t.id]);
    if (!items.length) return "";
    return `<div class="topic-browser">${items.map((t) => `<a class="topic-chip t-${t.id}" href="#/changes?topic=${t.id}${extraQuery}">${esc(t.label)} <b>${n[t.id]}</b></a>`).join("")}</div>`;
  }

  function feedRow(c) {
    const p = P(c.platform);
    return `<a class="feed-row" href="#/change/${enc(c.id)}">
      <span class="feed-date">${fmtDate(c.date)}</span>
      <div class="feed-doc" style="--platform:${p.color}"><i class="platform-dot"></i><div><strong>${esc(p.name)}</strong><span> · ${esc(c.document)}</span>${typeTag(c.type)}</div></div>
      <span class="feed-section">${topicTags(c)}${esc(c.sections.slice(0, 2).join(" · ")) || (c.topics && c.topics.length ? "" : "&nbsp;")}</span>
      ${diffBadge(c)}
    </a>`;
  }

  function sparkline(values) {
    const width = 110, height = 34, pad = 2, max = Math.max(...values, 1);
    const pts = values.map((v, i) => `${pad + i * (width - 2 * pad) / (values.length - 1)},${height - pad - v * (height - 2 * pad) / max}`).join(" ");
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly text changes, last 12 months"><polygon class="area" points="${pad},${height - pad} ${pts} ${width - pad},${height - pad}"/><polyline class="line" points="${pts}"/></svg>`;
  }

  // Stacked monthly bar chart. series: [{key, name, color}], keyOf(change) -> series key
  function stackedChart(series, list, keyOf, linkOf, n = 24) {
    const months = lastMonths(n);
    const counts = Object.fromEntries(months.map((m) => [m, Object.fromEntries(series.map((x) => [x.key, 0]))]));
    list.forEach((c) => { const m = counts[monthKey(c.date)]; const k = keyOf(c); if (m && k in m) m[k]++; });
    const totals = months.map((m) => Object.values(counts[m]).reduce((a, b) => a + b, 0));
    const step = Math.max(1, Math.ceil(Math.max(...totals, 4) / 4)), top = step * 4;
    const bars = months.map((m, i) => {
      const segs = series.map((x) => {
        const v = counts[m][x.key];
        return v ? `<span class="segment" style="height:${v / top * 100}%;background:${x.color}" title="${esc(x.name)}: ${v}"></span>` : "";
      }).join("");
      return `<a class="bar-column" href="${linkOf(m)}" style="--height:${totals[i] / top * 100}%">${segs}<span class="bar-label">${monthLabel(m)}</span><span class="chart-tooltip">${monthLabel(m)} · ${totals[i]} change${totals[i] === 1 ? "" : "s"}</span></a>`;
    }).join("");
    return {
      legend: `<div class="legend" aria-label="Chart legend">${series.map((x) => `<span class="legend-item"><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join("")}</div>`,
      html: `<article class="chart-card">
          <div class="chart-meta">
            <div><span>Total changes</span><strong>${totals.reduce((a, b) => a + b, 0)}</strong></div>
            <div class="chart-window"><span>${monthLabel(months[0])}</span><i></i><span>${monthLabel(months[n - 1])}</span></div>
          </div>
          <div class="chart-wrap">
            <div class="y-axis" aria-hidden="true">${[4, 3, 2, 1, 0].map((k) => `<span>${k * step}</span>`).join("")}</div>
            <div class="stacked-chart" role="img" aria-label="Stacked bar chart of monthly text changes over the last ${n} months">${bars}</div>
          </div>
        </article>`,
    };
  }

  // shades of one platform colour, one per service
  const shade = (color, i, n) => n < 2 ? color : `color-mix(in srgb, ${color}, ${i % 2 ? "#ffffff" : "#000000"} ${Math.round(12 + 50 * i / n)}%)`;

  // ---------- Announced updates (from banners in the current documents) ----------
  function upcomingHTML(list, { title = true } = {}) {
    if (!list.length) return "";
    const today = new Date(new Date().toDateString());
    const cards = list.map((a) => {
      const p = P(a.platform), eff = new Date(a.effective);
      const days = Math.round((eff - today) / 864e5);
      const when = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : `${-days} days ago`;
      const moves = a.date_history.length > 1
        ? `<div class="up-moved">Date moved ${a.date_history.length - 1} time${a.date_history.length > 2 ? "s" : ""}: ${a.date_history.map((h) => fmtDate(h.date)).join(" → ")}</div>` : "";
      const first = a.date_history[0];
      return `<article class="up-card" style="--platform:${p.color}">
        <div class="up-date"><span>${a.status === "upcoming" ? "Takes effect" : "In force since"}</span><strong>${fmtDate(a.effective)}</strong><em>${when}</em></div>
        <div class="up-main">
          <div class="up-doc"><i class="platform-dot" style="--platform:${p.color}"></i><b>${esc(p.name)}</b> · <a href="#/doc/${enc(a.doc_id)}">${esc(a.document)}</a></div>
          <p class="up-sentence">“${esc(a.sentence)}”</p>
          ${moves}
          <div class="up-actions">
            ${a.link ? `<a class="btn" href="${esc(a.link)}" target="_blank" rel="noopener">Read the announced version ↗</a>` : ""}
            ${first ? `<a class="btn" href="#/change/${enc(first.change)}">Announcement, ${fmtDate(first.seen)}</a>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
    return `<section class="shell section-block" id="upcoming">
      ${title ? `<div class="section-heading compact"><div><p class="eyebrow">Announced</p><h2>Upcoming changes</h2><p>Updates a platform has announced in its documents but that are not in force yet.</p></div></div>` : ""}
      <div class="up-list">${cards}</div>
      <p class="footnote">Detected from the notices platforms publish at the top of their documents. The text of the new version is usually only on the platform's preview page, which is not archived: open it with "Read the announced version".</p>
    </section>`;
  }

  // ---------- Overview ----------
  function viewHome() {
    const { index, changes } = state;
    const subst = changes.filter((c) => c.type === "substantive");
    const docs = index.platforms.reduce((a, p) => a + p.documents.length, 0);
    const last90 = subst.filter((c) => daysAgo(c.date) <= 90).length;
    const prev90 = subst.filter((c) => daysAgo(c.date) > 90 && daysAgo(c.date) <= 180).length;
    const trend = prev90 ? Math.round((last90 - prev90) / prev90 * 100) : null;
    const latest = subst[0];
    const stale = index.status.filter((s) => s.stale);

    const months = lastMonths(24);
    const chart = stackedChart(index.platforms.map((p) => ({ key: p.id, name: p.name, color: p.color })), subst, (c) => c.platform, (m) => `#/changes?month=${m}`);

    const cards = index.platforms.map((p) => {
      const ps = subst.filter((c) => c.platform === p.id);
      const spark = lastMonths(12).map((m) => ps.filter((c) => monthKey(c.date) === m).length);
      const recent = ps.slice(0, 3);
      return `<article class="platform-card" style="--platform:${p.color};--platform-dark:color-mix(in srgb, ${p.color}, #000 25%)">
        <div class="platform-accent"></div>
        <div class="platform-body">
          <a class="platform-title" href="#/platform/${p.id}"><div class="monogram" aria-hidden="true">${esc(p.monogram)}</div><div><h3>${esc(p.name)}</h3><p>${p.documents.length} documents · ${p.services.length} service${p.services.length > 1 ? "s" : ""}</p></div></a>
          <div class="chips">${p.services.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>
          <div class="platform-metrics">
            <div class="metric"><span>Documents<br>tracked</span><strong>${p.documents.length}</strong></div>
            <div class="metric"><span>Changes<br>· 90 days</span><strong>${ps.filter((c) => daysAgo(c.date) <= 90).length}</strong></div>
            <div class="metric"><span>Last<br>change</span><strong>${ps[0] ? fmtDate(ps[0].date) : "–"}</strong></div>
          </div>
          <div class="sparkline-block"><span>Monthly activity · 12 months</span>${sparkline(spark)}</div>
          <p class="recent-label">Most recent changes</p>
          <div>${recent.length ? recent.map((c) => `<a class="mini-change" href="#/change/${enc(c.id)}"><span class="mini-date">${short(c.date)}<br>${new Date(c.date).getFullYear()}</span><div class="mini-doc"><strong>${esc(c.document)}</strong><span>${esc(c.sections[0] || "")}</span></div>${diffBadge(c, "diff")}</a>`).join("")
            : `<p class="muted small">No text changes recorded yet.</p>`}</div>
          <a class="platform-link" href="#/platform/${p.id}">Open platform details <span>→</span></a>
        </div>
      </article>`;
    }).join("");

    app.innerHTML = `
      <section class="shell intro">
        <div>
          <p class="eyebrow">Policy intelligence</p>
          <h1>Terms &amp; conditions tracker</h1>
          <p class="subtitle">See when leading technology platforms update the terms and policies that shape digital services in Europe, and exactly what changed.</p>
        </div>
        <div class="updated"><span class="status-dot"></span>Last updated: <strong>${fmtDate(index.generated_at)}</strong></div>
      </section>
      ${stale.length ? `<div class="shell">${stale.map((s) => `<div class="notice">The source for <b>${esc(s.name)}</b> has not recorded anything for ${s.age_days ?? "many"} days. Recent changes may be missing.</div>`).join("")}</div>` : ""}

      <section class="shell summary-grid" aria-label="Summary statistics">
        <article class="summary-card"><div class="summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3.5h8l3 3V20.5H7z"/><path d="M15 3.5v4h4M10 11h5M10 14h5M10 17h3"/></svg></div>
          <div><p>Documents tracked</p><strong>${docs}</strong><span>terms, policies and guidelines</span></div></article>
        <article class="summary-card"><div class="summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.7 12h16.6M12 3.5c2.1 2.2 3.2 5 3.2 8.5S14.1 18.3 12 20.5C9.9 18.3 8.8 15.5 8.8 12S9.9 5.7 12 3.5z"/></svg></div>
          <div><p>Platforms</p><strong>${index.platforms.length}</strong><span>${index.platforms.reduce((a, p) => a + p.services.length, 0)} services monitored</span></div></article>
        <article class="summary-card"><div class="summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 18.5V14l4-3 4 2 7-7"/><path d="M15 6h4v4"/><path d="M4 20.5h16"/></svg></div>
          <div><p>Text changes · last 90 days</p><strong>${last90}</strong>${trend === null ? `<span>${subst.length} since tracking began</span>` : `<span class="${trend >= 0 ? "trend-up" : ""}">${trend >= 0 ? "↑" : "↓"} ${Math.abs(trend)}% vs previous 90 days</span>`}</div></article>
        <article class="summary-card latest-card"><div class="summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 4.5h12v15H6z"/><path d="M9 8h6M9 11h6M9 14h4"/></svg></div>
          <div><p>Latest change</p>${latest ? `<a href="#/change/${enc(latest.id)}"><strong class="date-value">${fmtDate(latest.date)}</strong><span>${esc(latest.platform_name)} · ${esc(latest.document)}</span></a>` : "<strong>–</strong>"}</div></article>
      </section>

      ${upcomingHTML(index.upcoming || [])}

      <section class="shell section-block" id="activity">
        <div class="section-heading">
          <div><p class="eyebrow">24-month view</p><h2>Activity by platform</h2><p>Monthly number of text changes. Click a month to see its changes.</p></div>
          ${chart.legend}
        </div>
        ${chart.html}
      </section>

      <section class="shell section-block" id="topics">
        <div class="section-heading compact"><div><p class="eyebrow">Topics</p><h2>Browse by topic</h2><p>Text changes of the last 12 months, by subject.</p></div></div>
        ${topicBrowser(changes)}
      </section>

      <section class="shell section-block" id="platforms">
        <div class="section-heading compact">
          <div><p class="eyebrow">Coverage</p><h2>Platforms</h2><p>Monitoring across products, services and policy documents.</p></div>
          <a class="text-link" href="#/changes">Compare all changes <span>→</span></a>
        </div>
        <div class="platform-grid">${cards}</div>
      </section>

      <section class="shell section-block" id="recent">
        <div class="section-heading compact feed-heading">
          <div><p class="eyebrow">Change log</p><h2>Recent changes</h2><p>The latest text changes across all monitored platforms.</p></div>
          <button class="export-button" type="button" id="exportButton"><svg viewBox="0 0 24 24"><path d="M12 3v11M8 10l4 4 4-4M5 17v3h14v-3"/></svg>Export log</button>
        </div>
        <article class="feed-card">
          <div class="filter-row" id="filterRow"></div>
          <div class="feed-labels" aria-hidden="true"><span>Date</span><span>Platform &amp; document</span><span>Affected sections</span><span>Change</span></div>
          <div class="feed" id="changeFeed"></div>
          <div class="feed-footer"><span id="feedCount"></span><a id="fullLog" href="#/changes">View full change log <span>→</span></a></div>
        </article>
      </section>`;

    let active = "";
    const renderFeed = () => {
      document.getElementById("filterRow").innerHTML = [{ id: "", name: "All platforms" }, ...index.platforms].map((p) =>
        `<button class="filter-chip ${p.id === active ? "active" : ""}" style="--dot:${p.color || "#8c92a3"}" data-filter="${p.id}" type="button">${p.id ? "<i></i>" : ""}${esc(p.name)}</button>`).join("");
      const list = active ? subst.filter((c) => c.platform === active) : subst;
      document.getElementById("changeFeed").innerHTML = list.length ? list.slice(0, 10).map(feedRow).join("") : `<div class="empty-state">No changes in this view.</div>`;
      document.getElementById("feedCount").textContent = `Showing ${Math.min(10, list.length)} of ${list.length} changes`;
      document.getElementById("fullLog").href = "#/changes" + (active ? `?platform=${active}` : "");
    };
    document.getElementById("filterRow").onclick = (e) => {
      const b = e.target.closest("[data-filter]");
      if (b) { active = b.dataset.filter; renderFeed(); }
    };
    document.getElementById("exportButton").onclick = () => exportCSV(subst, "tc-monitor-changes.csv");
    renderFeed();
  }

  // ---------- Platform detail ----------
  function viewPlatform(id) {
    const p = state.platforms[id];
    if (!p) return notFound();
    const all = state.changes.filter((c) => c.platform === id);
    const subst = all.filter((c) => c.type === "substantive");
    const last90 = subst.filter((c) => daysAgo(c.date) <= 90).length;
    const last365 = subst.filter((c) => daysAgo(c.date) <= 365).length;
    const since = p.documents.map((d) => d.tracked_since).filter(Boolean).sort()[0];
    const series = p.services.map((s, i) => ({ key: s, name: s, color: shade(p.color, i, p.services.length) }));
    const chart = stackedChart(series, subst, (c) => c.service, (m) => `#/changes?platform=${id}&month=${m}`);
    const st = state.index.status.find((x) => x.platform === id);

    // most changed sections in the last 12 months
    const secCount = {};
    subst.filter((c) => daysAgo(c.date) <= 365).forEach((c) => c.sections.forEach((x) => { secCount[x] = (secCount[x] || 0) + 1; }));
    const topSecs = Object.entries(secCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const docTable = p.services.map((svc) => {
      const docs = p.documents.filter((d) => d.service === svc)
        .sort((a, b) => (b.last_substantive_change || "").localeCompare(a.last_substantive_change || ""));
      return `<tbody>
        ${p.services.length > 1 ? `<tr class="svc-row"><td colspan="5">${esc(svc)}</td></tr>` : ""}
        ${docs.map((d) => {
          const n90 = subst.filter((c) => c.doc_id === d.id && daysAgo(c.date) <= 90).length;
          return `<tr>
            <td><a href="#/doc/${enc(d.id)}">${esc(p.services.length > 1 && d.name.startsWith(svc + " ") ? d.name.slice(svc.length + 1) : d.name)}</a></td>
            <td>${d.last_substantive_change ? fmtDate(d.last_substantive_change) : "–"}</td>
            <td class="num">${n90 || "–"}</td>
            <td class="num">${d.substantive_changes}</td>
            <td class="muted">${esc(d.declared_dates.slice(0, 2).join(", ") || "–")}</td>
          </tr>`;
        }).join("")}
      </tbody>`;
    }).join("");

    app.innerHTML = `
      <section class="shell page-head" style="--platform:${p.color};--platform-dark:color-mix(in srgb, ${p.color}, #000 25%)">
        <div class="crumbs"><a href="#/">Overview</a> › ${esc(p.name)}</div>
        <div class="platform-hero">
          <div class="monogram big" aria-hidden="true">${esc(p.monogram)}</div>
          <div>
            <h1>${esc(p.name)}</h1>
            <div class="chips">${p.services.map((s, i) => `<span class="chip"><i style="background:${series[i].color}"></i>${esc(s)}</span>`).join("")}</div>
          </div>
        </div>
        ${st && st.stale ? `<div class="notice">The source for ${esc(p.name)} has not recorded anything for ${st.age_days ?? "many"} days. Recent changes may be missing.</div>` : ""}
      </section>

      <section class="shell summary-grid" aria-label="${esc(p.name)} summary">
        <article class="summary-card"><div><p>Documents tracked</p><strong>${p.documents.length}</strong><span>${p.services.length} service${p.services.length > 1 ? "s" : ""}</span></div></article>
        <article class="summary-card"><div><p>Text changes · last 90 days</p><strong>${last90}</strong><span>${last365} in the last 12 months</span></div></article>
        <article class="summary-card"><div><p>Latest change</p>${subst[0] ? `<a href="#/change/${enc(subst[0].id)}"><strong class="date-value">${fmtDate(subst[0].date)}</strong><span>${esc(subst[0].document)}</span></a>` : "<strong>–</strong>"}</div></article>
        <article class="summary-card"><div><p>Tracked since</p><strong class="date-value">${fmtDate(since)}</strong><span>${subst.length} text changes in total</span></div></article>
      </section>

      ${upcomingHTML((state.index.upcoming || []).filter((a) => a.platform === id))}

      <section class="shell section-block">
        <div class="section-heading">
          <div><p class="eyebrow">24-month view</p><h2>Activity${p.services.length > 1 ? " by service" : ""}</h2><p>Monthly number of text changes. Click a month to see its changes.</p></div>
          ${p.services.length > 1 ? chart.legend : ""}
        </div>
        ${chart.html}
      </section>

      <section class="shell section-block">
        <div class="section-heading compact"><div><p class="eyebrow">Documents</p><h2>What is tracked</h2><p>Sorted by most recent text change${p.services.length > 1 ? ", grouped by service" : ""}.</p></div></div>
        <div class="card table-wrap"><table class="doc-table">
          <thead><tr><th>Document</th><th>Last text change</th><th class="num">90 days</th><th class="num">Total</th><th>Date stated in document</th></tr></thead>
          ${docTable}
        </table></div>
      </section>

      <section class="shell section-block">
        <div class="section-heading compact"><div><p class="eyebrow">Topics</p><h2>What the changes are about</h2><p>Text changes of the last 12 months, by subject.</p></div></div>
        ${topicBrowser(all, `&platform=${id}`) || `<p class="muted">No text changes in the last 12 months.</p>`}
      </section>

      ${topSecs.length ? `<section class="shell section-block">
        <div class="section-heading compact"><div><p class="eyebrow">Hotspots</p><h2>Most changed sections</h2><p>Sections with the most text changes in the last 12 months.</p></div></div>
        <div class="card pad hotspots">${topSecs.map(([name, n]) => `<a class="hot" href="#/changes?platform=${id}&q=${enc(name)}"><span>${esc(name)}</span><b>${n}</b></a>`).join("")}</div>
      </section>` : ""}

      <section class="shell section-block">
        <div class="section-heading compact feed-heading">
          <div><p class="eyebrow">Change log</p><h2>Recent changes</h2><p>The latest text changes for ${esc(p.name)}.</p></div>
          <button class="export-button" type="button" id="exportButton"><svg viewBox="0 0 24 24"><path d="M12 3v11M8 10l4 4 4-4M5 17v3h14v-3"/></svg>Export</button>
        </div>
        <article class="feed-card">
          <div class="feed-labels" aria-hidden="true"><span>Date</span><span>Platform &amp; document</span><span>Affected sections</span><span>Change</span></div>
          <div class="feed">${subst.slice(0, 15).map(feedRow).join("") || `<div class="empty-state">No text changes recorded yet.</div>`}</div>
          <div class="feed-footer"><span>Showing ${Math.min(15, subst.length)} of ${subst.length} changes</span><a href="#/changes?platform=${id}">View full change log <span>→</span></a></div>
        </article>
      </section>`;
    document.getElementById("exportButton").onclick = () => exportCSV(subst, `tc-monitor-${id}.csv`);
  }

  // ---------- Change log ----------
  function viewChanges(params) {
    const { index, changes } = state;
    const f = {
      platform: params.get("platform") || "",
      doc: params.get("doc") || "",
      month: params.get("month") || "",
      q: params.get("q") || "",
      topic: params.get("topic") || "",
      all: params.get("all") === "1",
    };
    let limit = 150;

    app.innerHTML = `
      <section class="shell page-head">
        <p class="eyebrow">Change log</p>
        <h1>All changes</h1>
        <p class="subtitle">Every recorded change, newest first. Filter by platform, document or topic, or search the changed text.</p>
      </section>
      <section class="shell">
        <article class="feed-card">
          <div class="filter-row" id="chips"></div>
          <div class="toolbar-row">
            <select id="f-doc" aria-label="Document"></select>
            <select id="f-topic" aria-label="Topic"><option value="">All topics</option>${(index.topics || []).map((t) => `<option value="${t.id}" ${t.id === f.topic ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>
            <input type="search" id="f-q" placeholder="Search the changed text, e.g. scraping, biometric, arbitration" value="${esc(f.q)}" aria-label="Filter">
            <label class="check"><input type="checkbox" id="f-all" ${f.all ? "checked" : ""}> Include minor changes</label>
            <button class="export-button" type="button" id="export"><svg viewBox="0 0 24 24"><path d="M12 3v11M8 10l4 4 4-4M5 17v3h14v-3"/></svg>Export</button>
          </div>
          <div id="list"></div>
          <div class="feed-footer"><span id="count"></span><button type="button" id="more">Show more <span>↓</span></button></div>
        </article>
        <p class="footnote">Minor changes are edits to links or formatting only, small edits of at most 5 words that do not touch words like "may", "must" or "not", wording that was reverted or lasted only a few days, date-only edits and technical updates of the archive.</p>
      </section>`;

    const filtered = () => {
      const q = f.q.toLowerCase();
      return state.changes.filter((c) =>
        (f.all || !MINOR.has(c.type)) &&
        (!f.platform || c.platform === f.platform) &&
        (!f.doc || c.doc_id === f.doc) &&
        (!f.month || monthKey(c.date) === f.month) &&
        (!f.topic || (c.topics || []).includes(f.topic)) &&
        (!q || c.document.toLowerCase().includes(q) || c.sections.join(" ").toLowerCase().includes(q) ||
          (state.search && (state.search[c.id] || "").toLowerCase().includes(q))));
    };

    const render = () => {
      document.getElementById("chips").innerHTML = [{ id: "", name: "All platforms" }, ...index.platforms].map((p) =>
        `<button class="filter-chip ${p.id === f.platform ? "active" : ""}" style="--dot:${p.color || "#8c92a3"}" data-filter="${p.id}" type="button">${p.id ? "<i></i>" : ""}${esc(p.name)}</button>`).join("")
        + (f.month ? `<button class="filter-chip active" data-month="1" type="button">${monthLabel(f.month)} ✕</button>` : "");
      const docs = index.platforms.filter((p) => !f.platform || p.id === f.platform)
        .flatMap((p) => p.documents.map((d) => ({ ...d, pname: p.name })))
        .sort((a, b) => (a.pname + a.name).localeCompare(b.pname + b.name));
      if (f.doc && !docs.some((d) => d.id === f.doc)) f.doc = "";
      document.getElementById("f-doc").innerHTML = `<option value="">All documents</option>` +
        docs.map((d) => `<option value="${d.id}" ${d.id === f.doc ? "selected" : ""}>${esc(f.platform ? d.name : d.pname + " · " + d.name)}</option>`).join("");

      const list = filtered();
      let html = "", cur = "";
      for (const c of list.slice(0, limit)) {
        const m = monthKey(c.date);
        if (m !== cur) { html += `<div class="month-head">${fmtDate(c.date, { month: "long", year: "numeric" })}</div>`; cur = m; }
        html += feedRow(c);
      }
      document.getElementById("list").innerHTML = list.length ? `<div class="feed-labels" aria-hidden="true"><span>Date</span><span>Platform &amp; document</span><span>Affected sections</span><span>Change</span></div>` + html
        : `<div class="empty-state">No changes match these filters.</div>`;
      document.getElementById("count").textContent = `Showing ${Math.min(limit, list.length)} of ${list.length} changes`;
      document.getElementById("more").style.display = list.length > limit ? "" : "none";
    };

    const sync = () => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v === true ? "1" : v);
      history.replaceState(null, "", "#/changes" + (p.toString() ? "?" + p : ""));
      limit = 150;
      render();
    };
    document.getElementById("chips").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.month) f.month = ""; else { f.platform = b.dataset.filter; f.doc = ""; }
      sync();
    };
    document.getElementById("f-doc").onchange = (e) => { f.doc = e.target.value; sync(); };
    document.getElementById("f-topic").onchange = (e) => { f.topic = e.target.value; sync(); };
    const loadSearch = async () => {
      if (state.search || state.searchLoading) return;
      state.searchLoading = true;
      try { state.search = await getJSON("data/search.json"); } catch (e) { console.error(e); }
      state.searchLoading = false;
      sync();
    };
    document.getElementById("f-q").onfocus = loadSearch;
    document.getElementById("f-q").oninput = (e) => { f.q = e.target.value; loadSearch(); sync(); };
    if (f.q) loadSearch();
    document.getElementById("f-all").onchange = async (e) => {
      f.all = e.target.checked;
      if (f.all && !state.minorLoaded) { document.getElementById("list").innerHTML = skeletonRows(6); await ensureMinor(); }
      sync();
    };
    if (f.all && !state.minorLoaded) ensureMinor().then(sync);
    document.getElementById("more").onclick = () => { limit += 300; render(); };
    document.getElementById("export").onclick = () => exportCSV(filtered(), "tc-monitor-changes.csv");
    render();
  }

  // ---------- Change detail ----------
  function wordDiff(a, b) {
    const ta = a.match(/\s+|[^\s]+/g) || [], tb = b.match(/\s+|[^\s]+/g) || [];
    if (ta.length * tb.length > 400000) return [`<del>${esc(a)}</del>`, `<ins>${esc(b)}</ins>`];
    const n = ta.length, m = tb.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0, oa = "", ob = "";
    while (i < n && j < m) {
      if (ta[i] === tb[j]) { oa += esc(ta[i]); ob += esc(tb[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) oa += `<del>${esc(ta[i++])}</del>`;
      else ob += `<ins>${esc(tb[j++])}</ins>`;
    }
    while (i < n) oa += `<del>${esc(ta[i++])}</del>`;
    while (j < m) ob += `<ins>${esc(tb[j++])}</ins>`;
    return [oa.replace(/<\/del>(\s*)<del>/g, "$1"), ob.replace(/<\/ins>(\s*)<ins>/g, "$1")];
  }

  // Make Markdown lines readable: links -> link text, drop escapes and emphasis marks
  const pretty = (l) => l
    .replace(/\\([^\w\s])/g, "$1")
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/\[([^\]]+)\](?!\()/g, "$1")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|[.,;:]|$)/g, "$1$2")
    .replace(/\u2060/g, "")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s+\|\s+/g, " · ")
    .replace(/^\s*[*-]\s{1,4}/, "• ");

  // ----- paragraph view of a change -----
  const isNoise = (l) => !l.trim() || /^\s*([-=_*]\s*){3,}$/.test(l) || /^\s*[*-]\s*$/.test(l);
  const isBullet = (l) => /^\s*([*+-]|\d+[.)])\s+/.test(l) || /^\s{4,}\S/.test(l);
  const words = (l) => (l.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  function similarity(a, b) {
    const wa = words(a), wb = words(b);
    if (!wa.length || !wb.length) return 0;
    const count = {};
    wa.forEach((w) => { count[w] = (count[w] || 0) + 1; });
    let common = 0;
    wb.forEach((w) => { if (count[w] > 0) { common++; count[w]--; } });
    return 2 * common / (wa.length + wb.length);
  }

  // Word-level diff as one merged token list: [{t: "eq"|"del"|"ins", s}]
  function mergeTokens(a, b) {
    const ta = a.match(/\s+|[^\s]+/g) || [], tb = b.match(/\s+|[^\s]+/g) || [];
    if (ta.length * tb.length > 400000) return [{ t: "del", s: a }, { t: "eq", s: " " }, { t: "ins", s: b }];
    const n = ta.length, m = tb.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    const push = (t, x) => { const last = out[out.length - 1]; if (last && last.t === t) last.s += x; else out.push({ t, s: x }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (ta[i] === tb[j]) { push("eq", ta[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", ta[i++]);
      else push("ins", tb[j++]);
    }
    while (i < n) push("del", ta[i++]);
    while (j < m) push("ins", tb[j++]);
    return cleanup(out);
  }

  // Semantic cleanup: tiny unchanged bits (a space or one short word) between two edits
  // are folded into the edit, and each edit run is shown as "all removed, then all added".
  // "Spark AR" -> "Meta Spark" becomes ~~Spark AR~~ Meta Spark instead of a mosaic.
  function cleanup(tokens) {
    const tiny = (x) => x.t === "eq" && (x.s.trim() === "" || (words(x.s).length <= 1 && x.s.trim().length <= 6));
    let changed = true, toks = tokens;
    while (changed) {
      changed = false;
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const x = toks[i];
        if (tiny(x) && out.length && out[out.length - 1].t !== "eq" && toks[i + 1] && toks[i + 1].t !== "eq") {
          out.push({ t: "del", s: x.s }, { t: "ins", s: x.s }); changed = true;
        } else out.push(x);
      }
      // regroup each run of edits: deletions first, then insertions
      toks = [];
      for (let i = 0; i < out.length;) {
        if (out[i].t === "eq") { toks.push(out[i++]); continue; }
        let del = "", ins = "";
        while (i < out.length && out[i].t !== "eq") { if (out[i].t === "del") del += out[i].s; else ins += out[i].s; i++; }
        if (del) toks.push({ t: "del", s: del });
        if (ins) toks.push({ t: "ins", s: ins });
      }
      if (!changed) break;
    }
    return toks;
  }
  const joinTokens = (toks) => toks.map((t, i) => tokHTML(t) + (t.t === "del" && toks[i + 1] && toks[i + 1].t === "ins" ? " " : "")).join("");
  const tokHTML = (tok) => tok.t === "eq" ? esc(tok.s) : tok.t === "del" ? `<del>${esc(tok.s)}</del>` : `<ins>${esc(tok.s)}</ins>`;

  // Keep only the sentences that contain an edit; returns {short, full, trimmed}
  function trimToChanges(tokens) {
    const full = joinTokens(tokens);
    const sentences = [[]];
    for (const tok of tokens) {
      if (tok.t !== "eq") { sentences[sentences.length - 1].push(tok); continue; }
      // split equal text after sentence-ending punctuation
      const parts = tok.s.split(/(?<=[.!?;:]["”’)]?)(\s+)/);
      parts.forEach((p, k) => {
        if (!p) return;
        sentences[sentences.length - 1].push({ t: "eq", s: p });
        if (k % 2 === 1) sentences.push([]);
      });
    }
    const keep = sentences.map((snt) => snt.some((x) => x.t !== "eq"));
    if (keep.every(Boolean) || full.length < 280) return { short: full, full, trimmed: false };
    let html = "", gap = false;
    sentences.forEach((snt, k) => {
      if (keep[k]) { html += (gap ? "… " : "") + joinTokens(snt); gap = false; }
      else gap = true;
    });
    if (gap) html = html.trimEnd() + " …";
    return { short: html, full, trimmed: true };
  }

  function hunkItems(h) {
    const items = [], lines = h.lines;
    let lead = h.lead || "";
    const setLead = (l) => { if (!isNoise(l) && !isBullet(l) && !/^#/.test(l)) lead = l.trim(); };
    for (let k = 0; k < lines.length;) {
      if (lines[k][0] === " ") { setLead(lines[k][1]); k++; continue; }
      const dels = [], adds = [];
      while (k < lines.length && lines[k][0] !== " ") {
        const [t, l] = lines[k++];
        if (isNoise(l)) continue;
        (t === "-" ? dels : adds).push(l);
      }
      const used = new Set(), pairOf = new Map();
      dels.forEach((d, i) => {
        let best = -1, bestS = 0;
        adds.forEach((a, j) => {
          if (used.has(j)) return;
          const sc = similarity(pretty(d), pretty(a));
          const min = Math.max(words(d).length, words(a).length) <= 8 ? 0.25 : 0.5;
          if (sc >= min && (best < 0 || sc > bestS)) { best = j; bestS = sc; }
        });
        if (best >= 0) { used.add(best); pairOf.set(best, i); }
      });
      const pairedDels = new Set(pairOf.values());
      const plain = (x) => pretty(x).replace(/\s+/g, " ").trim();
      const withLead = (it, raw) => {
        const prev = items[items.length - 1];
        const prevText = prev ? plain(prev.kind === "modified" ? prev.after : prev.text) : "";
        if (isBullet(raw) && lead && plain(lead) !== plain(raw) && plain(lead) !== prevText && !(prev && prev.lead && plain(prev.lead) === plain(lead))) it.lead = pretty(lead);
        return it;
      };
      dels.forEach((d, i) => { if (!pairedDels.has(i)) items.push(withLead({ kind: "removed", text: d }, d)); });
      adds.forEach((a, j) => {
        if (pairOf.has(j)) {
          const before = dels[pairOf.get(j)];
          if (plain(before) !== plain(a)) items.push(withLead({ kind: "modified", before, after: a }, a));
        } else items.push(withLead({ kind: "added", text: a }, a));
        setLead(a);
      });
    }
    return items;
  }

  function renderItem(it) {
    const lead = it.lead ? `<div class="pi-lead">${esc(it.lead.length > 220 ? it.lead.slice(0, 220) + "…" : it.lead)}</div>` : "";
    const longText = (txt) => {
      const t = esc(pretty(txt));
      return t.length > 600 ? `<p class="clamp">${t}</p><button type="button" class="pi-more" data-more>Show full paragraph</button>` : `<p>${t}</p>`;
    };
    if (it.kind === "modified") {
      const a = pretty(it.before), b = pretty(it.after);
      const tokens = mergeTokens(a, b);
      const changed = tokens.filter((x) => x.t !== "eq").reduce((n, x) => n + words(x.s).length, 0);
      const small = changed <= 15 || similarity(a, b) >= 0.75;
      if (small) {
        const { short, full, trimmed } = trimToChanges(tokens);
        return `<div class="pi mod" data-kind="modified">${lead}<p class="inline-diff" data-full="${esc(full)}">${short}</p>${trimmed ? `<button type="button" class="pi-more" data-full-toggle>Show full paragraph</button>` : ""}</div>`;
      }
      const [x, y] = wordDiff(a, b);
      return `<div class="pi mod" data-kind="modified">${lead}
        <div class="pi-row"><span class="pi-label">Before</span><p>${x}</p></div>
        <div class="pi-row"><span class="pi-label">After</span><p>${y}</p></div></div>`;
    }
    if (it.kind === "added") return `<div class="pi add" data-kind="added">${lead}${longText(it.text)}</div>`;
    const t = pretty(it.text);
    return `<details class="pi rem" data-kind="removed"><summary><span class="rem-label">Removed</span><span class="pi-preview">${esc(t.slice(0, 140))}${t.length > 140 ? "…" : ""}</span></summary>${lead}<p>${esc(t)}</p></details>`;
  }

  function renderChangeBody(hunks, docId) {
    const groups = [];
    for (const h of hunks) {
      const items = hunkItems(h);
      if (!items.length) continue;
      const last = groups[groups.length - 1];
      if (last && last.section === h.section) last.items.push(...items);
      else groups.push({ section: h.section, items });
    }
    if (!groups.length) return `<div class="card pad muted">Only formatting changed in this version.</div>`;
    const n = (k) => groups.reduce((a, g) => a + g.items.filter((i) => i.kind === k).length, 0);
    const pills = [["modified", "Modified"], ["added", "Added"], ["removed", "Removed"]]
      .filter(([k]) => n(k)).map(([k, label]) => `<button type="button" class="sum ${k}" data-kind-filter="${k}" aria-pressed="false"><i></i>${label} <b>${n(k)}</b></button>`).join("");
    const findLink = (g) => {
      const it = g.items.find((i) => i.kind !== "removed");
      if (!it) return "";
      const snippet = pretty(it.kind === "modified" ? it.after : it.text).replace(/\s+/g, " ").trim().slice(0, 80);
      return `<a class="find-link" href="#/doc/${enc(docId)}?find=${enc(snippet)}">View in document →</a>`;
    };
    return `<div class="change-summary">${pills}<span class="muted small">in ${groups.length} section${groups.length > 1 ? "s" : ""} · click to filter</span></div>
      <div class="change-body">` +
      groups.map((g) => `<div class="hunk"><div class="hunk-head"><span>${g.section ? `<b>${esc(g.section)}</b>` : "<b>Start of document</b>"}</span>${findLink(g)}</div>
        <div class="pi-list">${g.items.map(renderItem).join("")}</div></div>`).join("") + `</div>`;
  }

  // interactions inside a change page (event delegation)
  function wireChangeBody() {
    const body = app.querySelector(".change-body");
    if (!body) return;
    app.querySelectorAll("[data-kind-filter]").forEach((btn) => btn.addEventListener("click", () => {
      const on = btn.getAttribute("aria-pressed") !== "true";
      app.querySelectorAll("[data-kind-filter]").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", String(on));
      body.dataset.only = on ? btn.dataset.kindFilter : "";
      body.querySelectorAll(".hunk").forEach((h) => {
        h.hidden = on && !h.querySelector(`[data-kind="${btn.dataset.kindFilter}"]`);
      });
    }));
    body.addEventListener("click", (e) => {
      const ft = e.target.closest("[data-full-toggle]");
      if (ft) {
        const p = ft.previousElementSibling;
        if (!p.dataset.short) { p.dataset.short = p.innerHTML; p.innerHTML = p.dataset.full; ft.textContent = "Show only the changed sentences"; }
        else { p.innerHTML = p.dataset.short; delete p.dataset.short; ft.textContent = "Show full paragraph"; }
      }
      const more = e.target.closest("[data-more]");
      if (more) { const p = more.previousElementSibling; p.classList.toggle("clamp"); more.textContent = p.classList.contains("clamp") ? "Show full paragraph" : "Show less"; }
    });
  }

  async function viewChange(id) {
    const c = fillDefaults(await getJSON(`data/changes/${enc(id)}.json`));
    const d = docById(c.doc_id), p = P(c.platform);
    const docChanges = state.changes.filter((x) => x.doc_id === c.doc_id && !MINOR.has(x.type));
    const pos = docChanges.findIndex((x) => x.id === c.id);
    const newer = pos > 0 ? docChanges[pos - 1] : null;
    const older = pos >= 0 ? docChanges[pos + 1] : null;
    const body = c.type === "first"
      ? `<div class="card pad">This is the first version recorded for this document. <a class="text-link" href="#/doc/${enc(c.doc_id)}">Read the current text <span>→</span></a></div>`
      : renderChangeBody(c.hunks, c.doc_id);

    app.innerHTML = `
      <section class="shell page-head">
        <div class="crumbs"><a href="#/">Overview</a> › <a href="#/platform/${p.id || ""}">${esc(p.name)}</a> › <a href="#/doc/${enc(c.doc_id)}">${esc(c.document)}</a></div>
        <p class="eyebrow" style="color:${p.color} !important">${esc(p.name)}</p>
        <h1>${esc(c.document)} ${typeTag(c.type)}</h1>
        ${(c.topics || []).length ? `<div class="topic-browser small-gap">${c.topics.map((t) => `<a class="topic-chip t-${t}" href="#/changes?topic=${t}">${esc(topicLabel(t))}</a>`).join("")}</div>` : ""}
        <div class="meta-row">
          <span>Detected <b>${fmtDate(c.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</b></span>
          ${c.type !== "first" ? `<span>About <b>${c.words_changed ?? "?"}</b> words changed</span>` : ""}
          ${c.declared_dates.length ? `<span>Date stated in document: <b>${esc(c.declared_dates.join(", "))}</b></span>` : ""}
        </div>
        ${c.unstable ? `<div class="notice">This wording did not stay stable: the document switched back and forth between versions within a few weeks. Check the previous and next changes before relying on it.</div>` : ""}
        <div class="btn-row">
          <span>${older ? `<a class="btn" href="#/change/${enc(older.id)}">← Previous change</a>` : ""}${newer ? `<a class="btn" href="#/change/${enc(newer.id)}">Next change →</a>` : ""}</span>
          <span><a class="btn" href="#/doc/${enc(c.doc_id)}">Current text</a><a class="btn" href="${esc(c.source_commit)}" target="_blank" rel="noopener">Source record ↗</a>${d ? `<a class="btn" href="${esc(d.history_url)}" target="_blank" rel="noopener">Full history ↗</a>` : ""}</span>
        </div>
      </section>
      <section class="shell">
        ${body}
        <p class="footnote">"Detected" is when Open Terms Archive first recorded the new wording. The platform's own effective date can differ, see the date stated in the document.</p>
      </section>`;
    wireChangeBody();
  }

  // ---------- Document ----------
  async function viewDoc(id, params = new URLSearchParams()) {
    const d = docById(id);
    if (!d) return notFound();
    const md = await (await fetch(`data/current/${enc(id)}.md`)).text();
    const html = window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(md)) : `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
    const list = state.changes.filter((c) => c.doc_id === id && !MINOR.has(c.type));
    app.innerHTML = `
      <section class="shell page-head">
        <div class="crumbs"><a href="#/">Overview</a> › <a href="#/platform/${d.platform.id}">${esc(d.platform.name)}</a></div>
        <p class="eyebrow" style="color:${d.platform.color} !important">${esc(d.platform.name)}</p>
        <h1>${esc(d.name)}</h1>
        <div class="meta-row">
          <span>Last text change <b>${fmtDate(d.last_substantive_change)}</b></span>
          <span><b>${d.substantive_changes}</b> text changes since ${fmtDate(d.tracked_since)}</span>
          ${d.declared_dates.length ? `<span>Date stated in document: <b>${esc(d.declared_dates.join(", "))}</b></span>` : ""}
          <a class="text-link" href="${esc(d.current_url)}" target="_blank" rel="noopener">Source ↗</a>
        </div>
      </section>
      <section class="shell doc-layout">
        <article class="card doc-text">${html}</article>
        <aside class="card side-card"><h3>Change history</h3>
          ${list.map((c) => `<a class="side-row" href="#/change/${enc(c.id)}"><span class="d">${fmtDate(c.date)}${typeTag(c.type)}</span>${diffBadge(c, "diff")}<span class="s">${esc(c.sections.join(" · "))}</span></a>`).join("")}
        </aside>
      </section>`;
    const find = params.get("find");
    if (find) {
      const norm = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();
      const needle = norm(find).slice(0, 50);
      const el = [...app.querySelectorAll(".doc-text p, .doc-text li, .doc-text td, .doc-text h1, .doc-text h2, .doc-text h3, .doc-text h4")]
        .find((x) => norm(x.textContent).includes(needle));
      if (el) { el.classList.add("hl"); setTimeout(() => el.scrollIntoView({ block: "center" }), 50); }
      else app.querySelector(".doc-text").insertAdjacentHTML("afterbegin", `<p class="notice">This wording is no longer in the current version of the document.</p>`);
    }
  }

  // ---------- About ----------
  function viewAbout() {
    const { index } = state;
    app.innerHTML = `
      <section class="shell page-head"><p class="eyebrow">About</p><h1>How this tracker works</h1></section>
      <section class="shell about">
        <p>This site tracks changes to the terms of service, privacy policies and other contractual documents of major technology platforms. For each change it shows when it was detected, which sections were affected and the exact wording that was added or removed.</p>
        <h2>Method</h2>
        <ol>
          <li><a href="https://opentermsarchive.org">Open Terms Archive</a> downloads each document several times a day and records every new version in a public archive.</li>
          <li>Once a week this site reads that archive and compares each version with the previous one.</li>
          <li>Each change is classified. Only <b>text changes</b> are counted in the totals and charts. These are hidden by default as <b>minor changes</b>: edits to links or formatting only, <b>small edits</b> of at most 5 words (typos, contact details, names) unless they touch words that can change the meaning such as "may", "must", "not" or "consent", changes to page elements such as menus or survey banners, versions recorded while the source page showed an error, small edits of up to 50 words that return to a version seen in the previous 60 days or disappear again within 30 days (larger ones stay visible, with a warning), edits to the "updated" date only, and technical updates of the archive itself.</li>
        </ol>
        <h2>Topics</h2>
        <p>Each text change gets up to three topics (AI, Minors, Personal data, Advertising, Content moderation, Disputes &amp; liability, Payments &amp; pricing, Fraud &amp; security, IP &amp; licences, Law enforcement), assigned automatically from keywords in the changed text. They are a guide for browsing, not a legal classification: always read the change itself.</p>
        <h2>Licence and use</h2>
        <p>The TermRadar code and site are licensed under the <a href="https://polyformproject.org/licenses/noncommercial/1.0.0">PolyForm Noncommercial License 1.0.0</a>: they may be used, copied and adapted <b>only for non-commercial purposes</b>. Selling the tool, offering it as a paid service or using it in commercial products requires permission. The full text is in the LICENSE file of the source repository.</p>
        <p>The archived documents are the terms of the respective platforms and come from Open Terms Archive; this licence does not cover them.</p>
        <h2>Reading the dates</h2>
        <p>The <b>detection date</b> is when the new wording was first recorded. Platforms sometimes announce changes in advance, or change the text without updating the date in the document, so the <b>date stated in the document</b> is shown separately.</p>
        <h2>Which version of the documents?</h2>
        <p>Documents are archived as they appear to a visitor from the European Union. For OpenAI, the Terms of Service combine the Europe Terms of Use and the Service Terms.</p>
        <h2>Coverage</h2>
        <ul>${index.platforms.map((p) => `<li><b>${esc(p.name)}</b>: ${p.services.map(esc).join(", ")}, ${p.documents.length} documents. Source: ${p.sources.map((s) => `<a href="${esc(s)}">${esc(s.split("/").pop())}</a>`).join(", ")}</li>`).join("")}</ul>
        <p class="footnote">Data last rebuilt ${fmtDate(index.generated_at, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.</p>
      </section>`;
  }

  // ---------- Motion: entrance animations after each page render ----------
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function animatePage() {
    if (reduceMotion()) return;
    app.classList.remove("page-enter");
    void app.offsetWidth;            // restart the CSS animation
    app.classList.add("page-enter");
    // stagger: page sections, cards, rows and chart bars
    [...app.children].forEach((el, i) => el.style.setProperty("--i", i));
    app.querySelectorAll(".summary-card, .platform-card").forEach((el, i) => el.style.setProperty("--j", i));
    app.querySelectorAll(".feed-row, .hunk, .side-row, .doc-table tbody tr").forEach((el, i) => el.style.setProperty("--j", Math.min(i, 14)));
    app.querySelectorAll(".bar-column").forEach((el, i) => el.style.setProperty("--d", i));
    // numbers count up
    app.querySelectorAll(".summary-card strong, .metric strong, .chart-meta strong").forEach((el) => {
      const target = Number(el.textContent.trim());
      if (!Number.isFinite(target) || target <= 0 || !/^\d+$/.test(el.textContent.trim())) return;
      const t0 = performance.now(), dur = 700;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(target * e);
        if (k < 1) requestAnimationFrame(step);
      };
      el.textContent = "0";
      requestAnimationFrame(step);
    });
  }

  // ---------- AI side panel (visual only until an API key is available) ----------
  const panel = () => document.getElementById("aiPanel");
  function setPanel(open) {
    document.body.classList.toggle("ai-open", open);
    panel().setAttribute("aria-hidden", String(!open));
    document.getElementById("aiFab").setAttribute("aria-expanded", String(open));
    try { sessionStorage.setItem("aiPanel", open ? "1" : ""); } catch {}
  }
  // Suggested questions depend on the page being viewed
  function panelContext(parts, params) {
    let ctx = "Overview", qs = [
      "Which platforms changed their terms most in the last 3 months?",
      "What changed about AI and data use across platforms this year?",
      "Riassumi le modifiche più importanti di questo mese",
    ];
    const pl = (id) => (state.platforms[id] || {}).name || id;
    if (parts[0] === "platform" && parts[1]) {
      const n = pl(parts[1]);
      ctx = n; qs = [`Summarise ${n}'s most important changes this year`, `Which ${n} documents changed most recently, and how?`, `Cosa è cambiato per gli utenti europei di ${n}?`];
    } else if (parts[0] === "change" && parts[1]) {
      const c = state.changes.find((x) => x.id === decodeURIComponent(parts[1]));
      ctx = c ? `${c.platform_name} · ${c.document}, ${fmtDate(c.date)}` : "This change";
      qs = ["Explain this change in plain language", "What could this mean under the DSA or GDPR?", "Com'era questa sezione prima, e cosa cambia per gli utenti?"];
    } else if (parts[0] === "doc" && parts[1]) {
      const d = docById(decodeURIComponent(parts[1]));
      ctx = d ? `${d.platform.name} · ${d.name}` : "This document";
      qs = ["Summarise this document in 5 points", "What has changed in this document in the last year?", "Quali clausole riguardano i dati personali?"];
    } else if (parts[0] === "changes") {
      const p = params.get("platform");
      ctx = p ? `Change log · ${pl(p)}` : "Change log";
      qs = ["Which of these changes concern AI?", "Group these changes by topic", "Quali di queste modifiche riguardano i minori?"];
    } else if (parts[0] === "about") {
      ctx = "About"; qs = ["How does this tracker detect changes?", "Which documents are tracked for each platform?", "Cosa significa \"small edit\"?"];
    }
    document.getElementById("aiContext").textContent = ctx;
    document.getElementById("aiSuggest").innerHTML = qs.map((q) => `<button type="button" disabled>${esc(q)}</button>`).join("");
  }

  function notFound() { app.innerHTML = `<section class="shell page-head"><h1>Not found</h1><p><a class="text-link" href="#/">Back to overview <span>→</span></a></p></section>`; }

  // ---------- router ----------
  route.count = 0;
  async function route() {
    const [path, qs] = location.hash.replace(/^#/, "").split("?");
    const parts = (path || "/").split("/").filter(Boolean);
    const section = !parts.length || ["platform", "doc"].includes(parts[0]) ? "home" : ["changes", "change"].includes(parts[0]) ? "changes" : parts[0];
    document.querySelectorAll(".nav a").forEach((a) => {
      const on = a.dataset.nav === section;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    try {
      if (!parts.length) viewHome();
      else if (parts[0] === "changes") viewChanges(new URLSearchParams(qs || ""));
      else if (parts[0] === "change") { app.innerHTML = skeletonPage(); await viewChange(decodeURIComponent(parts[1])); }
      else if (parts[0] === "doc") { app.innerHTML = skeletonPage(); await viewDoc(decodeURIComponent(parts[1]), new URLSearchParams(qs || "")); }
      else if (parts[0] === "platform") viewPlatform(decodeURIComponent(parts[1] || ""));
      else if (parts[0] === "about") viewAbout();
      else if (parts[0] === "assistant") { setPanel(true); history.replaceState(null, "", "#/"); viewHome(); }
      else notFound();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<section class="shell page-head"><h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p></section>`;
    }
    try { panelContext(parts, new URLSearchParams(qs || "")); } catch (e) { console.error(e); }
    animatePage();
    const h1 = app.querySelector("h1");
    if (h1 && route.count++) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }

  (async () => {
    try {
      [state.index, state.changes] = await Promise.all([getJSON("data/index.json"), getJSON("data/changes.json")]);
      state.changes.forEach(fillDefaults);
    } catch (e) {
      app.innerHTML = `<section class="shell page-head"><h1>Data not available</h1><p class="muted">${esc(e.message)}</p></section>`;
      return;
    }
    state.index.platforms.forEach((p) => { state.platforms[p.id] = p; });
    document.getElementById("aiFab").onclick = () => setPanel(!document.body.classList.contains("ai-open"));
    document.getElementById("aiClose").onclick = () => setPanel(false);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setPanel(false); });
    try { if (sessionStorage.getItem("aiPanel")) setPanel(true); } catch {}
    window.addEventListener("hashchange", route);
    route();
  })();
})();
