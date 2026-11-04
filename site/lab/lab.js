// Chat lab: retrieval with EmbeddingGemma + answer generation in the browser
// (Chrome built-in Gemini Nano, or an open model through WebLLM).
const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
const WEBLLM = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";
const EMB_MODEL = "onnx-community/embeddinggemma-300m-ONNX";

const ENGINES = [
  { id: "nano", label: "Chrome built-in (Gemini Nano), no download", kind: "nano" },
  { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen3.5 2B, about 1 GB (recommended)", kind: "webllm" },
  { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen3.5 4B, about 2.3 GB", kind: "webllm" },
  { id: "Phi-4-mini-instruct-q4f16_1-MLC", label: "Phi-4-mini 3.8B, about 2.2 GB", kind: "webllm" },
  { id: "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC", label: "Ministral 3B, about 2 GB", kind: "webllm" },
  { id: "gemma-4-E2B-it-q4f16_1-MLC", label: "Gemma 4 E2B", kind: "webllm" },
  { id: "none", label: "No model: search only", kind: "none" },
];

const SAMPLES = [
  "What did Meta change about minors and teens this year?",
  "Cosa ha cambiato OpenAI nei suoi termini negli ultimi tre mesi?",
  "Has Anthropic changed how it uses cookies?",
  "Quali modifiche riguardano l'intelligenza artificiale nelle policy di Meta?",
  "What changed in the App Store Review Guidelines recently?",
  "Qu'est-ce qui a changé dans la politique de confidentialité de WhatsApp ?",
];

const PLATFORM_WORDS = {
  openai: ["openai", "chatgpt", "gpt"],
  anthropic: ["anthropic", "claude"],
  google: ["google", "gemini"],
  meta: ["meta", "facebook", "instagram", "whatsapp", "threads"],
  apple: ["apple", "app store", "appstore", "icloud", "ios"],
};
const SERVICE_WORDS = { facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp", threads: "Threads", icloud: "iCloud", "app store": "App Store", appstore: "App Store", chatgpt: "ChatGPT", claude: "Claude.ai" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const S = { changes: [], vectors: {}, dims: 256, emb: null, engine: null, engineId: null, busy: false };

// ---------- capabilities ----------
async function capabilities() {
  const out = { webgpu: false, nano: "unavailable" };
  try { out.webgpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch {}
  try { if (self.LanguageModel) out.nano = await LanguageModel.availability(); } catch {}
  return out;
}

// ---------- data ----------
async function loadData() {
  const [changes, vec] = await Promise.all([
    fetch("../data/changes.json").then((r) => r.json()),
    fetch("vectors.json").then((r) => r.ok ? r.json() : { vectors: {} }).catch(() => ({ vectors: {} })),
  ]);
  S.changes = changes.filter((c) => c.type === "substantive");
  S.dims = vec.dims || 256;
  for (const [id, b64] of Object.entries(vec.vectors)) {
    const bin = atob(b64), v = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) v[i] = ((bin.charCodeAt(i) << 24) >> 24) / 127;
    S.vectors[id] = v;
  }
}

async function loadEmbedder() {
  if (S.emb) return S.emb;
  note("Loading the search model (about 300 MB, first time only, then cached)…");
  const { AutoModel, AutoTokenizer, env } = await import(TRANSFORMERS);
  env.allowLocalModels = false;
  const tokenizer = await AutoTokenizer.from_pretrained(EMB_MODEL);
  const model = await AutoModel.from_pretrained(EMB_MODEL, { dtype: "q8", device: "wasm" });
  S.emb = async (text) => {
    const inputs = await tokenizer([text], { padding: true, truncation: true, max_length: 128 });
    const { sentence_embedding } = await model(inputs);
    const v = Array.from(sentence_embedding.data).slice(0, S.dims);
    const n = Math.hypot(...v);
    return Float32Array.from(v, (x) => x / n);
  };
  return S.emb;
}

// ---------- retrieval ----------
function parseFilters(q) {
  const l = q.toLowerCase();
  const platforms = Object.entries(PLATFORM_WORDS).filter(([, ws]) => ws.some((w) => new RegExp(`\\b${w}\\b`).test(l))).map(([id]) => id);
  const services = Object.entries(SERVICE_WORDS).filter(([w]) => new RegExp(`\\b${w}\\b`).test(l)).map(([, s]) => s);
  let since = null;
  const now = new Date();
  const m = l.match(/(?:last|past|ultim[io]|derniers?)\s+(\d+|two|three|six|due|tre|sei|deux|trois|six)\s+(months?|mes[ie]|mois|weeks?|settimane|semaines|years?|anni|ans)/);
  const words = { two: 2, three: 3, six: 6, due: 2, tre: 3, sei: 6, deux: 2, trois: 3 };
  if (m) {
    const n = Number(m[1]) || words[m[1]] || 1;
    const unit = m[2];
    const d = new Date(now);
    if (/week|settiman|semaine/.test(unit)) d.setDate(d.getDate() - 7 * n);
    else if (/year|ann|ans/.test(unit)) d.setFullYear(d.getFullYear() - n);
    else d.setMonth(d.getMonth() - n);
    since = d;
  } else if (/(last|past|ultimo|dernier)\s+(month|mese|mois)/.test(l)) { since = new Date(now); since.setMonth(since.getMonth() - 1); }
  else if (/(this year|quest'anno|quest’anno|cette année)/.test(l)) since = new Date(now.getFullYear(), 0, 1);
  else if (/(recent|recently|di recente|recenti|récemment)/.test(l)) { since = new Date(now); since.setMonth(since.getMonth() - 6); }
  const year = l.match(/\b(20[12]\d)\b/);
  let until = null;
  if (year && !since) { since = new Date(+year[1], 0, 1); until = new Date(+year[1] + 1, 0, 1); }
  return { platforms, services, since, until };
}

async function retrieve(q, k = 6) {
  const f = parseFilters(q);
  let pool = S.changes.filter((c) =>
    (!f.platforms.length || f.platforms.includes(c.platform)) &&
    (!f.services.length || f.services.includes(c.service)) &&
    (!f.since || new Date(c.date) >= f.since) &&
    (!f.until || new Date(c.date) < f.until));
  if (!pool.length) pool = S.changes;
  const embed = await loadEmbedder();
  const qv = await embed(`task: search result | query: ${q}`);
  const scored = pool.map((c) => {
    const v = S.vectors[c.id];
    let s = 0;
    if (v) for (let i = 0; i < qv.length; i++) s += qv[i] * v[i];
    // small recency bonus so that, at equal relevance, newer changes win
    s += 0.03 * Math.max(0, 1 - (Date.now() - new Date(c.date)) / (365 * 864e5));
    return [s, c];
  }).sort((a, b) => b[0] - a[0]);
  // at most 2 versions of the same document, so one noisy document cannot fill the list
  const perDoc = {}, picked = [];
  for (const [score, c] of scored) {
    if ((perDoc[c.doc_id] = (perDoc[c.doc_id] || 0) + 1) > 2) continue;
    picked.push({ score, c });
    if (picked.length === k) break;
  }
  return { filters: f, results: picked };
}

const clean = (s) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\\([\\_*\[\]().#|-])/g, "$1")
  .replace(/[*_`#>|]/g, " ").replace(/⁠/g, "").replace(/\s+/g, " ").trim();

async function contextFor(results, maxChars = 7000) {
  const per = Math.floor(maxChars / Math.max(1, results.length));
  const blocks = [];
  for (const [i, { c }] of results.entries()) {
    const full = await fetch(`../data/changes/${encodeURIComponent(c.id)}.json`).then((r) => r.json());
    const add = [], rem = [];
    for (const h of full.hunks) for (const [t, l] of h.lines) {
      if (t === "+" && l.trim()) add.push(clean(l));
      if (t === "-" && l.trim()) rem.push(clean(l));
    }
    const addT = add.join(" "), remT = rem.join(" ");
    const half = Math.floor(per / 2);
    blocks.push(`[${i + 1}] ${c.platform_name}, ${c.document}, detected ${c.date.slice(0, 10)}` +
      (c.sections.length ? `, sections: ${c.sections.slice(0, 4).join("; ")}` : "") +
      (remT ? `\nREMOVED: ${remT.slice(0, half)}${remT.length > half ? "…" : ""}` : "") +
      (addT ? `\nADDED: ${addT.slice(0, per - Math.min(half, remT.length))}${addT.length > per ? "…" : ""}` : ""));
  }
  return blocks.join("\n\n");
}

const SYSTEM = `You help EU policy analysts understand changes to the terms and policies of tech platforms.
Answer ONLY from the change records provided. Each record is numbered [1], [2], ...
Rules:
- Cite the records you use with their number in square brackets, e.g. [2].
- Say what was added or removed, and when. Do not invent changes, dates or legal consequences.
- If the records do not answer the question, say so plainly.
- Answer in the same language as the question. Be concise: at most 6 sentences or a short list.`;

// ---------- engines ----------
async function loadEngine(id) {
  const e = ENGINES.find((x) => x.id === id);
  $("progressWrap").hidden = true;
  if (e.kind === "none") { S.engine = null; S.engineId = id; status("Search only."); return; }
  if (e.kind === "nano") {
    const s = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: SYSTEM }],
      monitor(m) { m.addEventListener("downloadprogress", (ev) => progress(ev.loaded)); },
    });
    S.engine = { kind: "nano", session: s };
    S.engineId = id;
    status("Gemini Nano ready.");
    return;
  }
  status("Downloading the model, first time only. It stays in the browser cache afterwards.");
  $("progressWrap").hidden = false;
  const webllm = await import(WEBLLM);
  if (!webllm.prebuiltAppConfig.model_list.some((m) => m.model_id === id)) throw new Error(`Model ${id} is not available in this WebLLM version`);
  const engine = await webllm.CreateMLCEngine(id, {
    initProgressCallback: (p) => { progress(p.progress); status(p.text); },
  });
  S.engine = { kind: "webllm", engine };
  S.engineId = id;
  $("progressWrap").hidden = true;
  status(`${e.label.split(",")[0]} ready.`);
}

async function* generate(question, context) {
  const user = `Change records:\n\n${context}\n\nQuestion: ${question}`;
  if (S.engine.kind === "nano") {
    // a fresh clone per question keeps the context small
    const s = await S.engine.session.clone();
    let prev = "";
    for await (const chunk of s.promptStreaming(user)) {
      // older Chrome versions stream the full text so far, newer ones only the delta
      const piece = chunk.startsWith(prev) ? chunk.slice(prev.length) : chunk;
      prev = chunk.startsWith(prev) ? chunk : prev + chunk;
      yield piece;
    }
    s.destroy?.();
    return;
  }
  const stream = await S.engine.engine.chat.completions.create({
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
    stream: true, temperature: 0.2, max_tokens: 600,
    extra_body: { enable_thinking: false },
  });
  for await (const chunk of stream) yield chunk.choices[0]?.delta?.content || "";
}

// ---------- UI ----------
const status = (t) => { $("engineStatus").textContent = t; };
const progress = (x) => { $("progressBar").style.width = `${Math.round((x || 0) * 100)}%`; };
function bubble(cls, html) {
  const d = document.createElement("div");
  d.className = `msg ${cls}`;
  d.innerHTML = html;
  $("messages").appendChild(d);
  $("messages").scrollTop = $("messages").scrollHeight;
  return d;
}
const note = (t) => bubble("note", esc(t));

function renderAnswer(text, results) {
  const t = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
  return esc(t).replace(/\[(\d+)\]/g, (m, n) => {
    const r = results[+n - 1];
    return r ? `<a class="cite" href="../#/change/${encodeURIComponent(r.c.id)}" target="_blank" title="${esc(r.c.document)}">${n}</a>` : m;
  });
}

function showSources(results, f) {
  const fl = [f.platforms.length ? `platform: ${f.platforms.join(", ")}` : "", f.services.length ? `service: ${f.services.join(", ")}` : "",
    f.since ? `since ${fmtDate(f.since)}` : ""].filter(Boolean).join(" · ");
  $("sources").innerHTML = (fl ? `<p class="muted small" style="margin:0;padding:0 20px 8px">Filters understood: ${esc(fl)}</p>` : "") +
    results.map(({ c, score }, i) => `<a class="src" href="../#/change/${encodeURIComponent(c.id)}" target="_blank"><b>[${i + 1}]</b><strong>${esc(c.platform_name)} · ${esc(c.document)}</strong><span>${fmtDate(c.date)} · ${esc(c.sections.slice(0, 2).join(" · ") || "no section")} · relevance ${score.toFixed(2)}</span></a>`).join("");
  $("sources").classList.remove("pad-x");
}

async function ask(q) {
  if (S.busy || !q.trim()) return;
  S.busy = true; $("send").disabled = true;
  bubble("user", esc(q));
  const times = {};
  try {
    let t0 = performance.now();
    const { filters, results } = await retrieve(q);
    times.search = performance.now() - t0;
    showSources(results, filters);
    if (!S.engine) {
      bubble("bot", results.length ? `Here are the most relevant changes:\n` + results.map(({ c }, i) => `<a class="cite" href="../#/change/${encodeURIComponent(c.id)}" target="_blank">${i + 1}</a> ${esc(c.platform_name)} · ${esc(c.document)}, ${fmtDate(c.date)}`).join("\n") : "No matching changes found.");
    } else {
      t0 = performance.now();
      const context = await contextFor(results);
      times.context = performance.now() - t0;
      const b = bubble("bot", "…");
      let text = "", first = null, pieces = 0;
      t0 = performance.now();
      for await (const piece of generate(q, context)) {
        if (!first && piece) first = performance.now() - t0;
        text += piece; pieces++;
        b.innerHTML = renderAnswer(text, results) || "…";
        $("messages").scrollTop = $("messages").scrollHeight;
      }
      times.first = first;
      times.answer = performance.now() - t0;
      times.speed = pieces / (times.answer / 1000);
      b.innerHTML = renderAnswer(text, results) || "No answer.";
    }
  } catch (e) {
    console.error(e);
    bubble("note", `Error: ${esc(e.message)}`);
  }
  $("timing").innerHTML = [
    times.search != null && `<div>Search: <b>${(times.search / 1000).toFixed(1)} s</b></div>`,
    times.first != null && `<div>First words after: <b>${(times.first / 1000).toFixed(1)} s</b></div>`,
    times.answer != null && `<div>Full answer: <b>${(times.answer / 1000).toFixed(1)} s</b></div>`,
    times.speed && `<div>Speed: <b>${times.speed.toFixed(0)} tokens/s</b></div>`,
    `<div>Model: <b>${esc((ENGINES.find((e) => e.id === S.engineId) || { label: "none" }).label.split(",")[0])}</b></div>`,
  ].filter(Boolean).join("");
  S.busy = false; $("send").disabled = false;
}

(async () => {
  const caps = await capabilities();
  const opts = ENGINES.filter((e) => e.kind === "none" || (e.kind === "nano" ? caps.nano !== "unavailable" : caps.webgpu));
  $("engine").innerHTML = opts.map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join("");
  $("engine").value = caps.nano === "available" ? "nano" : caps.webgpu ? "Qwen3.5-2B-q4f16_1-MLC" : "none";
  $("caps").textContent = `This browser: WebGPU ${caps.webgpu ? "available" : "not available"} · Gemini Nano ${caps.nano}.` +
    (!caps.webgpu && caps.nano === "unavailable" ? " Only search is possible here, try Chrome or Edge on a computer." : "");
  $("samples").innerHTML = SAMPLES.map((s) => `<button type="button">${esc(s)}</button>`).join("");
  $("samples").onclick = (e) => { const b = e.target.closest("button"); if (b) { $("q").value = b.textContent; ask(b.textContent); } };
  $("form").onsubmit = (e) => { e.preventDefault(); const q = $("q").value; $("q").value = ""; ask(q); };
  $("q").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } };
  $("load").onclick = async () => {
    $("load").disabled = true;
    try { await loadEngine($("engine").value); } catch (e) { console.error(e); status(`Could not load: ${e.message}`); }
    $("load").disabled = false;
  };
  try { await loadData(); status(`${S.changes.length} changes loaded. Choose a model and click Load, or ask directly for search only.`); }
  catch (e) { status(`Could not load data: ${e.message}`); }
})();
