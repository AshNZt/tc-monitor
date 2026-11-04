// Precomputes search vectors for the chat prototype (site/lab/).
// For every text change it embeds a short description (platform, document,
// sections and the first words of the changed text) with EmbeddingGemma.
// The browser then only has to embed the user's question.
//
// Run:  npm i @huggingface/transformers@4.3.1 && node scripts/lab_vectors.mjs
import { AutoModel, AutoTokenizer } from "@huggingface/transformers";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DATA = path.join(ROOT, "site", "data");
const OUT = path.join(ROOT, "site", "lab", "vectors.json");
const DIMS = 256;
const MODEL = "onnx-community/embeddinggemma-300m-ONNX";

const clean = (s) => s
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\\([\\_*\[\]().#|-])/g, "$1")
  .replace(/[*_`#>|]/g, " ")
  .replace(/⁠/g, "")
  .replace(/\s+/g, " ")
  .trim();

export function describe(c, hunks) {
  const added = [], removed = [];
  for (const h of hunks) for (const [t, l] of h.lines) {
    if (t === "+" && l.trim()) added.push(clean(l));
    if (t === "-" && l.trim()) removed.push(clean(l));
  }
  const title = `${c.platform_name} ${c.document}`;
  const text = [
    c.sections.length ? `Sections: ${c.sections.join("; ")}.` : "",
    added.length ? `Added: ${added.join(" ").slice(0, 600)}` : "",
    removed.length ? `Removed: ${removed.join(" ").slice(0, 300)}` : "",
  ].filter(Boolean).join(" ");
  return `title: ${title} | text: ${text}`;
}

const all = JSON.parse(fs.readFileSync(path.join(DATA, "changes.json"), "utf8"))
  .filter((c) => c.type === "substantive");

// Incremental: keep vectors already computed with the same model, embed only new changes
let previous = {};
try {
  const old = JSON.parse(fs.readFileSync(OUT, "utf8"));
  if (old.model === MODEL && old.dims === DIMS) previous = old.vectors;
} catch {}
const keep = new Set(all.map((c) => c.id));
const changes = all.filter((c) => !previous[c.id]);
console.log(`${all.length} text changes, ${all.length - changes.length} already embedded, ${changes.length} to embed`);

const out = { model: MODEL, dims: DIMS, built_at: new Date().toISOString(),
  vectors: Object.fromEntries(Object.entries(previous).filter(([id]) => keep.has(id))) };
if (!changes.length) {
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("Nothing new to embed.");
  process.exit(0);
}
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await AutoModel.from_pretrained(MODEL, { dtype: "q8" });
const embed = async (texts) => {
  const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 256 });
  const { sentence_embedding } = await model(inputs);
  return sentence_embedding;
};
const t0 = Date.now();
const BATCH = 16;
for (let i = 0; i < changes.length; i += BATCH) {
  const batch = changes.slice(i, i + BATCH);
  const texts = batch.map((c) => {
    const full = JSON.parse(fs.readFileSync(path.join(DATA, "changes", `${c.id}.json`), "utf8"));
    return describe(c, full.hunks);
  });
  const res = await embed(texts);
  const arr = res.tolist();
  batch.forEach((c, k) => {
    const v = arr[k].slice(0, DIMS);
    const n = Math.hypot(...v);
    // int8 quantisation keeps the file small
    out.vectors[c.id] = Buffer.from(Int8Array.from(v.map((x) => Math.round((x / n) * 127))).buffer).toString("base64");
  });
  process.stdout.write(`\r${Math.min(i + BATCH, changes.length)}/${changes.length}`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${Object.keys(out.vectors).length} vectors in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
