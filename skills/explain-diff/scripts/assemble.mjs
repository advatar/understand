#!/usr/bin/env node
/*
 * assemble.mjs — turn a model-authored content spec into a self-contained explainer.
 *
 * Emits, under <root>/.understanding/:
 *   explainers/<slug>/index.html   self-contained (embedded CSS/JS, sticky TOC); NO answers, NO grading logic
 *   explainers/<slug>/manifest.json  metadata + question prompts/types (NO answers, NO nonces)  [committed]
 *   .nonces/<slug>.json            per-question nonces + rangeSha  [GITIGNORED — the anti-gaming secret]
 *   .gitignore                     ignores .work/ and .nonces/
 *   INDEX.md                       auto-maintained catalog (the shared-space entry point)
 *
 * The page collects the human's selections + free-text into a base64 "response blob" only — it embeds
 * neither the correct answers nor any grading. Grading is the separate `/understanding-gate --grade`
 * step (increment 2), which marks the blob against the diff and reads the gitignored nonces to mint a
 * pass token. Reading this HTML (or its source) reveals nothing that lets you fake a pass.
 *
 * Usage: node assemble.mjs --content <content.json> [--root <repoRoot>]
 * Framework-agnostic: no project imports, Node built-ins only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, "..", "assets", "template.html");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function die(msg) { console.error("assemble: " + msg); process.exit(1); }

const contentPath = arg("--content");
if (!contentPath) die("missing --content <content.json>");
const root = path.resolve(arg("--root", process.cwd()));

let c;
try { c = JSON.parse(fs.readFileSync(contentPath, "utf8")); }
catch (e) { die("cannot read/parse content: " + e.message); }

for (const k of ["title", "slug", "rangeSha", "background_html", "intuition_html", "code_html", "quiz"]) {
  if (c[k] === undefined || c[k] === null || c[k] === "") die(`content missing required field: ${k}`);
}
// slug builds filesystem paths — validate strictly (it always comes from resolve_range.sh).
if (!/^[0-9a-f]{7}-[0-9a-f]{7}(-[0-9a-f]{6})?$/.test(c.slug)) die(`invalid slug '${c.slug}' (expected NNNNNNN-NNNNNNN[-NNNNNN] hex from resolve_range.sh)`);

// --- quality gates the spec mandates (fail loudly, before we write anything) ---
const quiz = c.quiz;
if (!Array.isArray(quiz)) die("quiz must be an array");
const mcqs = quiz.filter((q) => q.type === "mcq");
const frees = quiz.filter((q) => q.type === "free");
if (mcqs.length < 5) die(`need >=5 MCQ questions, got ${mcqs.length}`);
if (frees.length < 1) die("need >=1 free-text question");
for (const q of quiz) {
  if (!q.id || !q.prompt) die("every question needs an id and prompt");
  if (q.type === "mcq" && (!Array.isArray(q.options) || q.options.length < 2))
    die(`MCQ ${q.id} needs >=2 options`);
}
const ids = quiz.map((q) => q.id);
if (new Set(ids).size !== ids.length) die("question ids must be unique");

// --- ENFORCE THE SELF-CHECK (SKILL.md step 4) ---
// Refuse to emit unless an independent grader self-check for THIS exact range is recorded as passed.
// This turns the core trust control from "agent discipline" into a hard precondition of emission.
// The report lives in the gitignored .work/ (it contains grader-derived answers — never committed).
const selfCheckPath = path.join(root, ".understanding", ".work", `${c.slug}.selfcheck.json`);
let selfCheck;
try { selfCheck = JSON.parse(fs.readFileSync(selfCheckPath, "utf8")); }
catch { die(`self-check missing: write a passed grader report to ${path.relative(root, selfCheckPath)} first (SKILL.md step 4). Refusing to emit.`); }
if (selfCheck.verdict !== "pass")
  die(`self-check verdict is '${selfCheck.verdict}', not 'pass' — reconcile the explainer/questions with the grader and re-run. Refusing to emit.`);
if (selfCheck.rangeSha !== c.rangeSha)
  die(`self-check rangeSha does not match this content — re-run the grader against the current diff. Refusing to emit.`);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- build the quiz HTML (radios + textareas; the "requires-a-code-fact" MCQ is flagged for the reader) ---
function quizHtml() {
  return quiz.map((q, i) => {
    const n = i + 1;
    const badge = q.requiresCodeFact ? ` <span class="u-badge" title="Answerable only from the code, not the prose above">reads the code</span>` : "";
    if (q.type === "mcq") {
      const opts = q.options.map((opt, oi) => {
        const val = String.fromCharCode(65 + oi); // A, B, C...
        return `<label class="u-opt"><input type="radio" name="${esc(q.id)}" value="${val}"><span class="u-optlabel"><b>${val}.</b> ${esc(opt)}</span></label>`;
      }).join("\n");
      return `<div class="u-q" data-qid="${esc(q.id)}" data-qtype="mcq">
  <p class="u-qprompt"><span class="u-qnum">Q${n}</span> ${esc(q.prompt)}${badge}</p>
  <div class="u-opts">${opts}</div>
</div>`;
    }
    return `<div class="u-q" data-qid="${esc(q.id)}" data-qtype="free">
  <p class="u-qprompt"><span class="u-qnum">Q${n}</span> ${esc(q.prompt)}${badge}</p>
  <textarea class="u-free" data-qid="${esc(q.id)}" rows="4" placeholder="Your answer in your own words…"></textarea>
</div>`;
  }).join("\n");
}

// --- per-question nonces (the gitignored secret) ---
const nonces = Object.fromEntries(quiz.map((q) => [q.id, crypto.randomBytes(16).toString("hex")]));

// --- assemble the page ---
const questionsForClient = quiz.map((q) => ({ id: q.id, type: q.type })); // NO answers
const tocItems = [
  ["background", "Background"],
  ["intuition", "Intuition"],
  ["code", "Code"],
  ["quiz", "Check yourself"],
];
const toc = tocItems.map(([id, label]) => `<a href="#${id}" class="u-tocitem">${label}</a>`).join("\n");

let tpl;
try { tpl = fs.readFileSync(TEMPLATE, "utf8"); } catch (e) { die("cannot read template: " + e.message); }

const generatedAt = new Date().toISOString();
const metaLine = [
  c.range ? `range <code>${esc(c.range)}</code>` : null,
  `base <code>${esc((c.baseSha || "").slice(0, 7))}</code> → head <code>${esc((c.headSha || "").slice(0, 7))}</code>`,
  (c.pathspec && c.pathspec.length) ? `scoped to <code>${esc(c.pathspec.join(" "))}</code>` : null,
].filter(Boolean).join(" · ");

// Use split/join (literal) rather than String.replace: authored HTML/JS legitimately contains
// `$'`, `$&`, `$\`` etc. (e.g. `textContent='$'+x`), which .replace would treat as special
// replacement patterns and corrupt the output.
let html = tpl;
for (const [tok, val] of [
  ["{{TITLE}}", esc(c.title)],
  ["{{META}}", metaLine],
  ["{{GENERATED_AT}}", esc(generatedAt)],
  ["{{SLUG}}", esc(c.slug)],
  ["{{RANGE_SHA}}", esc(c.rangeSha)],
  ["{{TOC}}", toc],
  ["{{BACKGROUND}}", c.background_html],
  ["{{INTUITION}}", c.intuition_html],
  ["{{CODE}}", c.code_html],
  ["{{QUIZ}}", quizHtml()],
  ["{{QUESTIONS_JSON}}", JSON.stringify(questionsForClient).replace(/</g, "\\u003c")],
]) {
  html = html.split(tok).join(val);
}

// --- write outputs ---
const uroot = path.join(root, ".understanding");
fs.mkdirSync(uroot, { recursive: true });

// .gitignore FIRST — before any secret (nonces) is written — so the anti-gaming files can never be
// staged, even in a fresh repo. (resolve_range.sh already does this; belt and suspenders.)
const giPath = path.join(uroot, ".gitignore");
const giHave = fs.existsSync(giPath) ? new Set(fs.readFileSync(giPath, "utf8").split("\n")) : new Set();
for (const want of [".work/", ".nonces/"]) if (!giHave.has(want)) fs.appendFileSync(giPath, want + "\n");

const outDir = path.join(uroot, "explainers", c.slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "index.html"), html);

const manifest = {
  slug: c.slug, title: c.title, range: c.range || null,
  baseSha: c.baseSha || null, headSha: c.headSha || null, rangeSha: c.rangeSha,
  pathspec: c.pathspec || [], generatedAt,
  // committed audit record that the self-check ran and passed for this range — NO answers.
  selfCheck: { verdict: selfCheck.verdict, checkedAt: selfCheck.checkedAt || generatedAt },
  questions: quiz.map((q) => ({ id: q.id, type: q.type, prompt: q.prompt, ...(q.type === "mcq" ? { options: q.options.length } : {}) })),
  schema: "understanding/explainer@1",
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const nonceDir = path.join(uroot, ".nonces");
fs.mkdirSync(nonceDir, { recursive: true });
fs.writeFileSync(path.join(nonceDir, `${c.slug}.json`), JSON.stringify({ slug: c.slug, rangeSha: c.rangeSha, nonces, createdAt: generatedAt }, null, 2) + "\n");

// INDEX.md — the shared-space catalog. Idempotent upsert keyed by slug.
const idxPath = path.join(uroot, "INDEX.md");
const row = `| [\`${c.slug}\`](explainers/${c.slug}/index.html) | ${c.title.replace(/\|/g, "\\|")} | \`${(c.headSha || "").slice(0, 7)}\` | ${generatedAt.slice(0, 10)} |`;
const header = `# Understanding index\n\nSelf-contained explainers for consequential diffs. Open any \`index.html\` in a browser.\n\n| Explainer | What it teaches | Head | Generated |\n|---|---|---|---|\n`;
let lines = [];
if (fs.existsSync(idxPath)) {
  lines = fs.readFileSync(idxPath, "utf8").split("\n").filter((l) => l.startsWith("| [`") && !l.includes(`[\`${c.slug}\``));
}
fs.writeFileSync(idxPath, header + [row, ...lines].join("\n") + "\n");

console.log(JSON.stringify({
  ok: true, slug: c.slug,
  explainer: path.relative(root, path.join(outDir, "index.html")),
  manifest: path.relative(root, path.join(outDir, "manifest.json")),
  nonces: path.relative(root, path.join(nonceDir, `${c.slug}.json`)),
  mcqs: mcqs.length, free: frees.length,
}));
