/* T&C Monitor dashboard. Plain JavaScript, no build step.
   Reads data/index.json, data/changes.json and data/changes/<id>.json */
(() => {
  const app = document.getElementById("app");
  const state = { index: null, changes: null, cache: {} };

  const TYPE_LABEL = {
    substantive: "Text change",
    "date-only": "Date only",
    technical: "Technical",
    first: "First record",
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso, opts = { day: "numeric", month: "short", year: "numeric" }) =>
    iso ? new Date(iso).toLocaleDateString("en-GB", opts) : "–";
  const monthKey = (iso) => iso.slice(0, 7);
  const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso)) / 864e5);
  const ago = (iso) => {
    const d = daysAgo(iso);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? `${d} days ago` : `${Math.round(d / 30)} months ago`;
  };
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
  const tag = (type) => type === "substantive" ? "" : `<span class="tag ${type}">${TYPE_LABEL[type]}</span>`;
  const counts = (c) => c.type === "first" ? "" :
    `<span class="counts"><span class="plus">+${c.added}</span> <span class="minus">−${c.removed}</span></span>`;

  function changeRow(c, { showDoc = true } = {}) {
    const secs = c.sections.length ? c.sections.join(" · ") : "";
    return `<li><a class="row" href="#/change/${encodeURIComponent(c.id)}">
      <span class="date">${fmtDate(c.date)}</span>
      <span>${showDoc ? `<span class="doc">${esc(c.platform_name)} · ${esc(c.document)}</span>${tag(c.type)}` : tag(c.type) || ""}
        ${secs ? `<span class="secs">${esc(secs)}</span>` : ""}</span>
      ${counts(c)}</a></li>`;
  }

  // ---------- chart: substantive changes per month ----------
  function monthChart(changes, months = 24) {
    const now = new Date();
    const keys = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const n = Object.fromEntries(keys.map((k) => [k, 0]));
    changes.forEach((c) => { if (c.type === "substantive" && n[monthKey(c.date)] !== undefined) n[monthKey(c.date)]++; });
    const max = Math.max(4, ...Object.values(n));
    const W = 720, H = 170, L = 28, B = 22, T = 8, bw = (W - L) / months;
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const step = Math.ceil(max / 4);
    let g = "";
    for (let v = 0; v <= max; v += step)
      g += `<line class="grid" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const bars = keys.map((k, i) => {
      const v = n[k], x = L + i * bw + 2, h = (H - T - B) * v / max;
      const label = new Date(k + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      const xl = (i % 3 === 0) ? `<text x="${x + (bw - 4) / 2}" y="${H - 6}" text-anchor="middle">${new Date(k + "-01").toLocaleDateString("en-GB", { month: "short" })}${k.endsWith("-01") || i === 0 ? " " + k.slice(2, 4) : ""}</text>` : "";
      return `<a href="#/changes?month=${k}"><rect class="bar" x="${x}" y="${H - B - h}" width="${bw - 4}" height="${Math.max(h, v ? 2 : 0)}" rx="2"><title>${label}: ${v} change${v === 1 ? "" : "s"}</title></rect></a>${xl}`;
    }).join("");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Text changes per month, last ${months} months">${g}${bars}</svg>`;
  }

  // ---------- views ----------
  function viewHome() {
    const { index, changes } = state;
    const subst = changes.filter((c) => c.type === "substantive");
    const last90 = subst.filter((c) => daysAgo(c.date) <= 90).length;
    const docs = index.platforms.reduce((a, p) => a + p.documents.length, 0);
    const stale = index.status.filter((s) => s.stale);

    let html = `<h1>Terms &amp; conditions tracker</h1>
      <p class="muted">Every change to the terms and policies of major digital platforms, with the date and the exact wording added or removed.</p>`;
    if (stale.length) html += stale.map((s) => `<div class="notice">The source for <b>${esc(s.platform)}</b> has not recorded anything for ${s.age_days} days. Changes may be missing.</div>`).join("");

    html += `<div class="kpis">
      <div class="card pad kpi"><div class="label">Documents tracked</div><div class="value">${docs}</div><div class="sub">${index.platforms.map((p) => esc(p.name)).join(", ")}</div></div>
      <div class="card pad kpi"><div class="label">Text changes, last 90 days</div><div class="value">${last90}</div><div class="sub">${subst.length} since tracking began</div></div>
      <div class="card pad kpi"><div class="label">Latest change</div><div class="value">${subst[0] ? fmtDate(subst[0].date, { day: "numeric", month: "short" }) : "–"}</div><div class="sub">${subst[0] ? esc(subst[0].document) : ""}</div></div>
    </div>`;

    html += `<h2>Activity</h2><div class="card pad">${monthChart(changes)}<p class="muted small" style="margin:6px 0 0">Text changes per month across all documents. Click a bar to see that month.</p></div>`;

    for (const p of index.platforms) {
      const rows = [...p.documents].sort((a, b) => (b.last_substantive_change || "").localeCompare(a.last_substantive_change || ""));
      html += `<h2>${esc(p.name)} <span class="muted small" style="font-weight:400">${esc(p.service)}</span></h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>Document</th><th>Last text change</th><th class="num">Changes</th><th>Declared date</th><th>Tracked since</th></tr></thead>
        <tbody>${rows.map((d) => `<tr>
          <td><a href="#/doc/${encodeURIComponent(d.id)}">${esc(d.name)}</a></td>
          <td>${d.last_substantive_change ? `${fmtDate(d.last_substantive_change)}<br><span class="muted small">${ago(d.last_substantive_change)}</span>` : "–"}</td>
          <td class="num">${d.substantive_changes}</td>
          <td class="small">${esc(d.declared_dates.join(", ") || "–")}</td>
          <td class="small muted">${fmtDate(d.tracked_since)}</td></tr>`).join("")}</tbody>
      </table></div>`;
    }

    html += `<h2>Recent changes</h2><div class="card"><ul class="changes">${subst.slice(0, 10).map((c) => changeRow(c)).join("")}</ul></div>
      <p><a class="btn" href="#/changes">All changes →</a></p>`;
    app.innerHTML = html;
  }

  function viewChanges(params) {
    const { index, changes } = state;
    const f = {
      platform: params.get("platform") || "",
      doc: params.get("doc") || "",
      month: params.get("month") || "",
      q: params.get("q") || "",
      all: params.get("all") === "1",
    };
    const docs = index.platforms.flatMap((p) => p.documents.map((d) => ({ ...d, pid: p.id, pname: p.name })))
      .filter((d) => !f.platform || d.pid === f.platform);

    app.innerHTML = `<h1>Changes</h1>
      <div class="filters">
        <select id="f-platform" aria-label="Platform"><option value="">All platforms</option>${index.platforms.map((p) => `<option value="${p.id}" ${p.id === f.platform ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <select id="f-doc" aria-label="Document"><option value="">All documents</option>${docs.map((d) => `<option value="${d.id}" ${d.id === f.doc ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
        <input type="search" id="f-q" placeholder="Filter by section, e.g. privacy, cookies, API" value="${esc(f.q)}" aria-label="Filter by section">
        <label class="check"><input type="checkbox" id="f-all" ${f.all ? "checked" : ""}> Include date-only and technical</label>
        ${f.month ? `<a class="btn" href="#/changes">${esc(f.month)} ✕</a>` : ""}
      </div>
      <div id="list"></div>`;

    const render = () => {
      const q = f.q.toLowerCase();
      const list = changes.filter((c) =>
        (f.all || c.type === "substantive" || c.type === "first") &&
        (!f.platform || c.platform === f.platform) &&
        (!f.doc || c.doc_id === f.doc) &&
        (!f.month || monthKey(c.date) === f.month) &&
        (!q || c.sections.join(" ").toLowerCase().includes(q) || c.document.toLowerCase().includes(q)));
      let html = "", cur = "";
      for (const c of list) {
        const m = monthKey(c.date);
        if (m !== cur) {
          if (cur) html += "</ul>";
          html += `<div class="month">${fmtDate(c.date, { month: "long", year: "numeric" })}</div><ul class="changes">`;
          cur = m;
        }
        html += changeRow(c);
      }
      if (cur) html += "</ul>";
      document.getElementById("list").innerHTML =
        `<p class="muted small">${list.length} result${list.length === 1 ? "" : "s"}</p>` +
        (list.length ? `<div class="card">${html}</div>` : `<div class="card pad muted">No changes match these filters.</div>`);
    };

    const sync = () => {
      const p = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v && v !== false) p.set(k, v === true ? "1" : v); });
      history.replaceState(null, "", "#/changes" + (p.toString() ? "?" + p : ""));
      render();
    };
    document.getElementById("f-platform").onchange = (e) => { f.platform = e.target.value; f.doc = ""; sync(); viewChanges(new URLSearchParams(location.hash.split("?")[1])); };
    document.getElementById("f-doc").onchange = (e) => { f.doc = e.target.value; sync(); };
    document.getElementById("f-q").oninput = (e) => { f.q = e.target.value; sync(); };
    document.getElementById("f-all").onchange = (e) => { f.all = e.target.checked; sync(); };
    render();
  }

  // word-level diff between a removed and an added line
  function wordDiff(a, b) {
    const ta = a.match(/\s+|[^\s]+/g) || [], tb = b.match(/\s+|[^\s]+/g) || [];
    if (ta.length * tb.length > 400000) return [esc(a), esc(b)];
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
    .replace(/\u2060/g, "")
    .replace(/^\s*[*-]\s{1,4}/, "• ");

  function renderHunk(h) {
    const out = [];
    const lines = h.lines;
    for (let k = 0; k < lines.length;) {
      const [t, l] = lines[k];
      if (t === " ") { out.push(l.trim() ? `<div class="dl ctx">${esc(pretty(l))}</div>` : ""); k++; continue; }
      const dels = [], adds = [];
      while (k < lines.length && lines[k][0] === "-") dels.push(lines[k++][1]);
      while (k < lines.length && lines[k][0] === "+") adds.push(lines[k++][1]);
      let D = dels.filter((x) => x.trim()), A = adds.filter((x) => x.trim());
      const pD = D.map(pretty), pA = A.map(pretty);
      // keep raw Markdown only when the change is inside a link address or formatting
      if (pD.join("\n") !== pA.join("\n")) { D = pD; A = pA; }
      const pairs = Math.min(D.length, A.length);
      const hd = [], ha = [];
      for (let p = 0; p < pairs; p++) { const [x, y] = wordDiff(D[p], A[p]); hd.push(x); ha.push(y); }
      D.slice(pairs).forEach((x) => hd.push(`<del>${esc(x)}</del>`));
      A.slice(pairs).forEach((x) => ha.push(`<ins>${esc(x)}</ins>`));
      hd.forEach((x) => out.push(`<div class="dl del">${x}</div>`));
      ha.forEach((x) => out.push(`<div class="dl add">${x}</div>`));
    }
    return `<div class="card hunk"><div class="hunk-head"><span>${h.section ? `Section: <b>${esc(h.section)}</b>` : "<b>Start of document</b>"}</span><span>line ${h.new_start}</span></div>${out.join("")}</div>`;
  }

  async function viewChange(id) {
    const c = await getJSON(`data/changes/${encodeURIComponent(id)}.json`);
    const d = docById(c.doc_id);
    const docChanges = state.changes.filter((x) => x.doc_id === c.doc_id);
    const pos = docChanges.findIndex((x) => x.id === c.id);
    const newer = docChanges[pos - 1], older = docChanges[pos + 1];

    let body;
    if (c.type === "first") {
      body = `<div class="card pad">This is the first version recorded for this document. <a href="#/doc/${encodeURIComponent(c.doc_id)}">Read the current text</a>.</div>`;
    } else {
      body = c.hunks.map(renderHunk).join("");
    }
    app.innerHTML = `
      <div class="crumbs"><a href="#/changes">Changes</a> › <a href="#/doc/${encodeURIComponent(c.doc_id)}">${esc(c.platform_name)} · ${esc(c.document)}</a></div>
      <h1>${esc(c.document)} ${tag(c.type)}</h1>
      <div class="meta">
        <span>Detected <b>${fmtDate(c.date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</b></span>
        ${c.type !== "first" ? `<span><b class="plus">+${c.added}</b> lines added, <b class="minus">−${c.removed}</b> removed</span>` : ""}
        ${c.declared_dates.length ? `<span>Date stated in document: <b>${esc(c.declared_dates.join(", "))}</b></span>` : ""}
      </div>
      <div class="toolbar">
        <span>
          ${older ? `<a class="btn" href="#/change/${encodeURIComponent(older.id)}">← Previous change</a>` : ""}
          ${newer ? `<a class="btn" href="#/change/${encodeURIComponent(newer.id)}">Next change →</a>` : ""}
        </span>
        <span><a class="btn" href="${esc(c.source_commit)}" target="_blank" rel="noopener">Source record ↗</a>
        ${d ? `<a class="btn" href="${esc(d.history_url)}" target="_blank" rel="noopener">Full history ↗</a>` : ""}</span>
      </div>
      ${body}
      <p class="muted small">"Detected" is when Open Terms Archive first recorded the new wording. The platform's own effective date can differ, see the date stated in the document.</p>`;
  }

  async function viewDoc(id) {
    const d = docById(id);
    if (!d) return notFound();
    const r = await fetch(`data/current/${encodeURIComponent(id)}.md`);
    const md = await r.text();
    const html = window.marked && window.DOMPurify
      ? DOMPurify.sanitize(marked.parse(md))
      : `<pre style="white-space:pre-wrap">${esc(md)}</pre>`;
    const list = state.changes.filter((c) => c.doc_id === id && c.type !== "technical" && c.type !== "date-only");
    app.innerHTML = `
      <div class="crumbs"><a href="#/">Overview</a> › ${esc(d.platform.name)}</div>
      <h1>${esc(d.name)}</h1>
      <div class="meta">
        <span>Last text change <b>${fmtDate(d.last_substantive_change)}</b></span>
        <span><b>${d.substantive_changes}</b> changes since ${fmtDate(d.tracked_since)}</span>
        ${d.declared_dates.length ? `<span>Date stated in document: <b>${esc(d.declared_dates.join(", "))}</b></span>` : ""}
      </div>
      <div class="doc-layout">
        <article class="card doc-text">${html}</article>
        <aside class="card side"><h3>Change history</h3><ul class="changes">${list.map((c) => changeRow(c, { showDoc: false })).join("")}</ul>
          <p class="pad small" style="margin:0"><a href="#/changes?doc=${encodeURIComponent(id)}">Open in change list →</a></p></aside>
      </div>`;
  }

  function viewAbout() {
    app.innerHTML = `<div class="about">
      <h1>About</h1>
      <p>This site tracks changes to the terms of service, privacy policies and other contractual documents of major digital platforms. For each change it shows when it was detected, which sections were affected, and the exact wording that was added or removed.</p>
      <h2>How it works</h2>
      <ol>
        <li><a href="https://opentermsarchive.org">Open Terms Archive</a> downloads each document several times a day and records every new version in a public archive.</li>
        <li>Once a week, this site reads that archive, compares each version with the previous one, and filters out noise such as rotating tracking IDs in links.</li>
        <li>Changes that only touch the "Updated" date line are marked as <i>Date only</i>. Changes caused by an update of the archive's own extraction rules are marked as <i>Technical</i>. Both are hidden by default.</li>
      </ol>
      <h2>Reading the dates</h2>
      <p>The <b>detection date</b> is when the new wording was first recorded. Platforms sometimes announce changes in advance, or update the text without changing the date in the document, so the <b>date stated in the document</b> is shown separately.</p>
      <h2>Which version of the documents?</h2>
      <p>Documents are archived as they appear to a visitor from the European Union. For OpenAI, the Terms of Service entry combines the Europe Terms of Use and the Service Terms.</p>
      <h2>Sources</h2>
      <ul>${state.index.platforms.map((p) => `<li>${esc(p.name)}: <a href="${esc(p.source)}">${esc(p.source)}</a>${p.declarations ? ` (<a href="${esc(p.declarations)}">what is tracked</a>)` : ""}</li>`).join("")}</ul>
      <p class="muted small">Data last rebuilt ${fmtDate(state.index.generated_at, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}.</p>
    </div>`;
  }

  function notFound() { app.innerHTML = `<h1>Not found</h1><p><a href="#/">Back to overview</a></p>`; }

  // ---------- router ----------
  async function route() {
    const [path, qs] = location.hash.replace(/^#/, "").split("?");
    const parts = (path || "/").split("/").filter(Boolean);
    const params = new URLSearchParams(qs || "");
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active",
      a.dataset.nav === (parts[0] === "changes" || parts[0] === "change" ? "changes" : parts[0] === "about" ? "about" : parts.length ? "" : "home")));
    try {
      if (!parts.length) viewHome();
      else if (parts[0] === "changes") viewChanges(params);
      else if (parts[0] === "change") await viewChange(decodeURIComponent(parts[1]));
      else if (parts[0] === "doc") await viewDoc(decodeURIComponent(parts[1]));
      else if (parts[0] === "about") viewAbout();
      else notFound();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(e.message)}</p>`;
    }
    if (!location.hash.startsWith("#/changes")) window.scrollTo(0, 0);
  }

  (async () => {
    try {
      [state.index, state.changes] = await Promise.all([getJSON("data/index.json"), getJSON("data/changes.json")]);
    } catch (e) {
      app.innerHTML = `<h1>Data not available</h1><p class="muted">${esc(e.message)}</p>`;
      return;
    }
    const a = state.index.author;
    if (a) { const el = document.getElementById("author-link"); el.textContent = a.name; el.href = a.url; }
    document.getElementById("generated").textContent = `Updated ${fmtDate(state.index.generated_at)}.`;
    window.addEventListener("hashchange", route);
    route();
  })();
})();
