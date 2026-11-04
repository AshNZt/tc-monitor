/* T&C Monitor dashboard. Plain JavaScript, no build step.
   Reads data/index.json, data/changes.json and data/changes/<id>.json */
(() => {
  const app = document.getElementById("app");
  const state = { index: null, changes: null, cache: {}, platforms: {} };

  // Change types. Only "substantive" counts as a text change in totals and charts.
  const TYPE_LABEL = {
    substantive: "Text change",
    first: "First record",
    formatting: "Links or formatting only",
    reverted: "Reverted to earlier wording",
    temporary: "Short-lived wording",
    "date-only": "Date only",
    technical: "Technical",
  };
  const MINOR = new Set(["formatting", "reverted", "temporary", "date-only", "technical"]);

  // ---------- helpers ----------
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
    `<span class="${cls}"><span class="plus">+${c.added}</span><span class="minus">−${c.removed} lines</span></span>`;
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

  function feedRow(c) {
    const p = P(c.platform);
    return `<a class="feed-row" href="#/change/${enc(c.id)}">
      <span class="feed-date">${fmtDate(c.date)}</span>
      <div class="feed-doc" style="--platform:${p.color}"><i class="platform-dot"></i><div><strong>${esc(p.name)}</strong><span> · ${esc(c.document)}</span>${typeTag(c.type)}</div></div>
      <span class="feed-section">${esc(c.sections.slice(0, 3).join(" · ")) || "&nbsp;"}</span>
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
          <div>${recent.length ? recent.map((c) => `<a class="mini-change" href="#/change/${enc(c.id)}"><span class="mini-date">${short(c.date)}<br>${new Date(c.date).getFullYear()}</span><div class="mini-doc"><strong>${esc(c.document)}</strong><span>${esc(c.sections[0] || "")}</span></div><span class="diff"><span class="plus">+${c.added}</span><span class="minus">−${c.removed}</span></span></a>`).join("")
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

      <section class="shell section-block" id="activity">
        <div class="section-heading">
          <div><p class="eyebrow">24-month view</p><h2>Activity by platform</h2><p>Monthly number of text changes. Click a month to see its changes.</p></div>
          ${chart.legend}
        </div>
        ${chart.html}
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
      all: params.get("all") === "1",
    };
    let limit = 150;

    app.innerHTML = `
      <section class="shell page-head">
        <p class="eyebrow">Change log</p>
        <h1>All changes</h1>
        <p class="subtitle">Every recorded change, newest first. Filter by platform, document or section.</p>
      </section>
      <section class="shell">
        <article class="feed-card">
          <div class="filter-row" id="chips"></div>
          <div class="toolbar-row">
            <select id="f-doc" aria-label="Document"></select>
            <input type="search" id="f-q" placeholder="Filter by section or document, e.g. cookies, AI, minors" value="${esc(f.q)}" aria-label="Filter">
            <label class="check"><input type="checkbox" id="f-all" ${f.all ? "checked" : ""}> Include minor changes</label>
            <button class="export-button" type="button" id="export"><svg viewBox="0 0 24 24"><path d="M12 3v11M8 10l4 4 4-4M5 17v3h14v-3"/></svg>Export</button>
          </div>
          <div id="list"></div>
          <div class="feed-footer"><span id="count"></span><button type="button" id="more">Show more <span>↓</span></button></div>
        </article>
        <p class="footnote">Minor changes are edits to links or formatting only, wording that was reverted or lasted only a few days, date-only edits and technical updates of the archive.</p>
      </section>`;

    const filtered = () => {
      const q = f.q.toLowerCase();
      return changes.filter((c) =>
        (f.all || !MINOR.has(c.type)) &&
        (!f.platform || c.platform === f.platform) &&
        (!f.doc || c.doc_id === f.doc) &&
        (!f.month || monthKey(c.date) === f.month) &&
        (!q || c.document.toLowerCase().includes(q) || c.sections.join(" ").toLowerCase().includes(q)));
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
    document.getElementById("f-q").oninput = (e) => { f.q = e.target.value; sync(); };
    document.getElementById("f-all").onchange = (e) => { f.all = e.target.checked; sync(); };
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
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/\\([\\_*\[\]().#|-])/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|[.,;:]|$)/g, "$1$2")
    .replace(/⁠/g, "")
    .replace(/^\s*[*-]\s{1,4}/, "• ");

  function renderHunk(h) {
    const out = [], lines = h.lines;
    for (let k = 0; k < lines.length;) {
      const [t, l] = lines[k];
      if (t === " ") { if (l.trim()) out.push(`<div class="dl ctx">${esc(pretty(l))}</div>`); k++; continue; }
      const dels = [], adds = [];
      while (k < lines.length && lines[k][0] === "-") dels.push(lines[k++][1]);
      while (k < lines.length && lines[k][0] === "+") adds.push(lines[k++][1]);
      let D = dels.filter((x) => x.trim()), A = adds.filter((x) => x.trim());
      const pD = D.map(pretty), pA = A.map(pretty);
      // keep raw Markdown only when the change is inside a link address or formatting
      if (pD.join("\n") !== pA.join("\n")) { D = pD; A = pA; }
      const pairs = Math.min(D.length, A.length), hd = [], ha = [];
      for (let p = 0; p < pairs; p++) { const [x, y] = wordDiff(D[p], A[p]); hd.push(x); ha.push(y); }
      D.slice(pairs).forEach((x) => hd.push(`<del>${esc(x)}</del>`));
      A.slice(pairs).forEach((x) => ha.push(`<ins>${esc(x)}</ins>`));
      hd.forEach((x) => out.push(`<div class="dl del">${x}</div>`));
      ha.forEach((x) => out.push(`<div class="dl add">${x}</div>`));
    }
    return `<div class="hunk"><div class="hunk-head"><span>${h.section ? `Section: <b>${esc(h.section)}</b>` : "<b>Start of document</b>"}</span><span>line ${h.new_start}</span></div>${out.join("")}</div>`;
  }

  async function viewChange(id) {
    const c = await getJSON(`data/changes/${enc(id)}.json`);
    const d = docById(c.doc_id), p = P(c.platform);
    const docChanges = state.changes.filter((x) => x.doc_id === c.doc_id && !MINOR.has(x.type));
    const pos = docChanges.findIndex((x) => x.id === c.id);
    const newer = pos > 0 ? docChanges[pos - 1] : null;
    const older = pos >= 0 ? docChanges[pos + 1] : null;
    const body = c.type === "first"
      ? `<div class="card pad">This is the first version recorded for this document. <a class="text-link" href="#/doc/${enc(c.doc_id)}">Read the current text <span>→</span></a></div>`
      : c.hunks.map(renderHunk).join("");

    app.innerHTML = `
      <section class="shell page-head">
        <div class="crumbs"><a href="#/">Overview</a> › <a href="#/platform/${p.id || ""}">${esc(p.name)}</a> › <a href="#/doc/${enc(c.doc_id)}">${esc(c.document)}</a></div>
        <p class="eyebrow" style="color:${p.color} !important">${esc(p.name)}</p>
        <h1>${esc(c.document)} ${typeTag(c.type)}</h1>
        <div class="meta-row">
          <span>Detected <b>${fmtDate(c.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</b></span>
          ${c.type !== "first" ? `<span><b class="plus">+${c.added}</b> lines added, <b class="minus">−${c.removed}</b> removed</span>` : ""}
          ${c.declared_dates.length ? `<span>Date stated in document: <b>${esc(c.declared_dates.join(", "))}</b></span>` : ""}
        </div>
        <div class="btn-row">
          <span>${older ? `<a class="btn" href="#/change/${enc(older.id)}">← Previous change</a>` : ""}${newer ? `<a class="btn" href="#/change/${enc(newer.id)}">Next change →</a>` : ""}</span>
          <span><a class="btn" href="#/doc/${enc(c.doc_id)}">Current text</a><a class="btn" href="${esc(c.source_commit)}" target="_blank" rel="noopener">Source record ↗</a>${d ? `<a class="btn" href="${esc(d.history_url)}" target="_blank" rel="noopener">Full history ↗</a>` : ""}</span>
        </div>
      </section>
      <section class="shell">
        ${body}
        <p class="footnote">"Detected" is when Open Terms Archive first recorded the new wording. The platform's own effective date can differ, see the date stated in the document.</p>
      </section>`;
  }

  // ---------- Document ----------
  async function viewDoc(id) {
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
          <li>Each change is classified. Only <b>text changes</b> are counted in the totals and charts. These are hidden by default as <b>minor changes</b>: edits to links or formatting only, wording that returns to a version seen in the previous 60 days, wording that disappears again within 30 days, edits to the "updated" date only, and technical updates of the archive itself.</li>
        </ol>
        <h2>Reading the dates</h2>
        <p>The <b>detection date</b> is when the new wording was first recorded. Platforms sometimes announce changes in advance, or change the text without updating the date in the document, so the <b>date stated in the document</b> is shown separately.</p>
        <h2>Which version of the documents?</h2>
        <p>Documents are archived as they appear to a visitor from the European Union. For OpenAI, the Terms of Service combine the Europe Terms of Use and the Service Terms.</p>
        <h2>Coverage</h2>
        <ul>${index.platforms.map((p) => `<li><b>${esc(p.name)}</b>: ${p.services.map(esc).join(", ")}, ${p.documents.length} documents. Source: ${p.sources.map((s) => `<a href="${esc(s)}">${esc(s.split("/").pop())}</a>`).join(", ")}</li>`).join("")}</ul>
        <p class="footnote">Data last rebuilt ${fmtDate(index.generated_at, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.</p>
      </section>`;
  }

  function notFound() { app.innerHTML = `<section class="shell page-head"><h1>Not found</h1><p><a class="text-link" href="#/">Back to overview <span>→</span></a></p></section>`; }

  // ---------- router ----------
  async function route() {
    const [path, qs] = location.hash.replace(/^#/, "").split("?");
    const parts = (path || "/").split("/").filter(Boolean);
    const section = !parts.length || ["platform", "doc"].includes(parts[0]) ? "home" : ["changes", "change"].includes(parts[0]) ? "changes" : parts[0];
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
    try {
      if (!parts.length) viewHome();
      else if (parts[0] === "changes") viewChanges(new URLSearchParams(qs || ""));
      else if (parts[0] === "change") await viewChange(decodeURIComponent(parts[1]));
      else if (parts[0] === "doc") await viewDoc(decodeURIComponent(parts[1]));
      else if (parts[0] === "platform") viewPlatform(decodeURIComponent(parts[1] || ""));
      else if (parts[0] === "about") viewAbout();
      else notFound();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<section class="shell page-head"><h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p></section>`;
    }
    window.scrollTo(0, 0);
  }

  (async () => {
    try {
      [state.index, state.changes] = await Promise.all([getJSON("data/index.json"), getJSON("data/changes.json")]);
    } catch (e) {
      app.innerHTML = `<section class="shell page-head"><h1>Data not available</h1><p class="muted">${esc(e.message)}</p></section>`;
      return;
    }
    state.index.platforms.forEach((p) => { state.platforms[p.id] = p; });
    const a = state.index.author;
    if (a && a.name) { const el = document.getElementById("author-link"); el.textContent = a.name; if (a.url) el.href = a.url; }
    window.addEventListener("hashchange", route);
    route();
  })();
})();
