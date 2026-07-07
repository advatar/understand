#!/usr/bin/env node
/*
 * world.mjs — identity, build, and staleness for micro-worlds (increment 3).
 *
 * A micro-world is a single-file, human-driven interactive model of a subsystem — a
 * re-implementation FOR UNDERSTANDING (not a wrapper on the live app). Because the "human drives"
 * property amplifies a wrong model, a micro-world is SHA-STAMPED and can be checked for staleness.
 *
 *   resolve   {mode, slug, sha, ref, range|paths, baseSha, headSha} for a git range OR a subsystem
 *   build     assemble worlds/<slug>/index.html + manifest.json from an authored content spec
 *   check     recompute the sha and compare to the stamped one → fresh | stale (exit 0 | 1)
 *
 * Staleness model:
 *   - range mode      the diff between two fixed commits is IMMUTABLE → fresh unless a commit is gone.
 *   - subsystem mode  tracks the paths' content at HEAD *and the working tree* → stale on any change.
 *
 * Exit codes:  0 ok/fresh · 1 stale · 2 validation/IO error.  Node built-ins only; framework-agnostic.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, "..", "assets", "template.html");
const RESOLVER = path.join(__dirname, "..", "..", "explain-diff", "scripts", "resolve_range.sh");
const KNOWN_FLAGS = new Set(["--range", "--paths", "--root", "--content", "--slug", "--all"]);

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def; }
// collect args after `flag` up to (but not including) the next KNOWN flag or a bare `--`.
function argsAfter(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    const a = process.argv[j];
    if (a === "--" || KNOWN_FLAGS.has(a)) break;
    out.push(a);
  }
  return out;
}
function die(msg, code = 2) { console.error("world: " + msg); process.exit(code); }
function warn(msg) { console.error("world: warning — " + msg); }
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// safe JSON for embedding inside a <script> — neutralises </script> and <!-- breakouts.
const jsonInScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const SLUG_RE = /^([0-9a-f]{7}-[0-9a-f]{7}(-[0-9a-f]{6})?|sub-[0-9a-f]{12})$/;
function assertSlug(s) { if (!s || !SLUG_RE.test(s)) die(`invalid slug '${s || ""}'`); return s; }

function git(args, cwd) { return execFileSync("git", args, { cwd, encoding: "utf8" }); }
function gitOk(args, cwd) { try { git(args, cwd); return true; } catch { return false; } }
function uroot(root) { return path.join(root, ".understanding"); }

// content id of a subsystem = hash of tracked blobs (ls-tree) PLUS working-tree divergence
// (status --porcelain), so a modified-but-uncommitted or newly-untracked file also flips it.
function subsystemSha(root, paths) {
  let tree = "", status = "";
  try { tree = git(["ls-tree", "-r", "HEAD", "--", ...paths], root); } catch (e) { die("git ls-tree failed: " + (e.stderr || e.message), 2); }
  try { status = git(["status", "--porcelain", "--", ...paths], root); } catch { status = ""; }
  const treeLines = tree.split("\n").filter(Boolean).sort();
  const statusLines = status.split("\n").filter(Boolean).sort();
  if (treeLines.length === 0 && statusLines.length === 0) die(`no tracked or working-tree files match ${JSON.stringify(paths)}`, 2);
  return { sha: sha256(treeLines.join("\n") + "\n--worktree--\n" + statusLines.join("\n")), fileCount: treeLines.length, dirty: statusLines.length > 0 };
}

function resolveIdentity(root) {
  const rangeArg = arg("--range");
  const paths = argsAfter("--paths");
  if (rangeArg) {
    const dashIdx = process.argv.indexOf("--");
    const pathspec = dashIdx >= 0 ? process.argv.slice(dashIdx) : [];
    let out;
    try { out = execFileSync("bash", [RESOLVER, rangeArg, ...pathspec], { cwd: root, encoding: "utf8" }); }
    catch (e) { die("resolve_range failed: " + (e.stderr || e.message), 2); }
    let j; try { j = JSON.parse(out); } catch (e) { die("resolver output not JSON: " + e.message, 2); }
    if (j.error) die("resolver: " + j.error, 2);
    return { mode: "range", slug: j.slug, sha: j.rangeSha, ref: j.headSha, range: rangeArg, paths: j.pathspec || [], baseSha: j.baseSha, headSha: j.headSha };
  }
  if (paths.length) {
    const ref = git(["rev-parse", "HEAD"], root).trim();
    const { sha, fileCount, dirty } = subsystemSha(root, paths);
    if (fileCount === 0) warn("subsystem matches only untracked files — staleness will be working-tree-relative.");
    if (dirty) warn("working tree is dirty for these paths — the world's sha bakes in that state; build from a clean tree for a commit-anchored world.");
    return { mode: "subsystem", slug: `sub-${sha.slice(0, 12)}`, sha, ref, range: null, paths, fileCount };
  }
  die("resolve needs --range <range> [-- pathspec]  OR  --paths <path>...");
}

function currentShaFor(root, m) {
  if (m.mode === "range") {
    const ok = m.baseSha && m.headSha && gitOk(["cat-file", "-e", m.baseSha + "^{commit}"], root) && gitOk(["cat-file", "-e", m.headSha + "^{commit}"], root);
    return ok ? m.sha : "MISSING-COMMITS"; // immutable diff: fresh iff both endpoints still resolve
  }
  return subsystemSha(root, m.paths).sha;
}

const cmd = process.argv[2];
const root = path.resolve(arg("--root", process.cwd()));

if (cmd === "resolve") { console.log(JSON.stringify(resolveIdentity(root))); process.exit(0); }

if (cmd === "check") {
  const uDir = uroot(root);
  const worldsDir = path.join(uDir, "worlds");
  const all = process.argv.includes("--all");
  let slugs;
  if (all) {
    slugs = fs.existsSync(worldsDir)
      ? fs.readdirSync(worldsDir).filter((d) => SLUG_RE.test(d) && fs.existsSync(path.join(worldsDir, d, "manifest.json")))
      : [];
  } else {
    slugs = [assertSlug(arg("--slug"))];
  }
  let anyStale = false;
  const rows = [];
  for (const slug of slugs) {
    const mp = path.join(worldsDir, slug, "manifest.json");
    let m;
    try { m = JSON.parse(fs.readFileSync(mp, "utf8")); }
    catch (e) {
      if (all) { warn(`skipping ${slug}: unreadable manifest (${e.message})`); anyStale = true; rows.push({ slug, stale: true, mode: "?" }); continue; }
      die(`manifest for ${slug} unreadable: ${e.message}`, 2);
    }
    for (const k of ["slug", "mode", "sha"]) if (m[k] === undefined) { if (all) { warn(`${slug}: manifest missing ${k}`); } else die(`manifest for ${slug} missing ${k}`, 2); }
    const stale = currentShaFor(root, m) !== m.sha;
    anyStale = anyStale || stale;
    rows.push({ slug, stale, mode: m.mode });
    if (!all) console.log(JSON.stringify({ ok: true, slug, stale, mode: m.mode }));
  }
  if (all) { rewriteWorldsIndex(root, rows); console.log(JSON.stringify({ ok: true, checked: rows.length, stale: rows.filter((r) => r.stale).length })); }
  process.exit(anyStale ? 1 : 0);
}

if (cmd === "build") {
  const contentPath = arg("--content") || die("build needs --content <content.json>");
  let c; try { c = JSON.parse(fs.readFileSync(contentPath, "utf8")); } catch (e) { die("cannot read content: " + e.message, 2); }
  for (const k of ["title", "slug", "mode", "sha", "model_html", "fidelity", "worldSeed"]) {
    if (c[k] === undefined || c[k] === null || c[k] === "") die(`content missing required field: ${k}`);
  }
  assertSlug(c.slug);
  if (!Array.isArray(c.fidelity) || c.fidelity.length === 0) die("fidelity must be a non-empty array (the faithful-vs-reimplemented map)");
  for (const f of c.fidelity) if (!f.aspect || !["faithful", "simplified", "omitted"].includes(f.status)) die("each fidelity entry needs {aspect, status: faithful|simplified|omitted, note}");
  if (typeof c.worldSeed !== "object" || c.worldSeed === null || Array.isArray(c.worldSeed)) die("worldSeed must be a non-null JSON object of real fixture data");
  // human-driven heuristic: a timer-only model with no input handler is an autoplay demo, not a world.
  if (/\b(setInterval|setTimeout|requestAnimationFrame)\b/.test(c.model_html) && !/addEventListener|on(input|click|change|pointerdown|keydown)/.test(c.model_html))
    warn("model_html uses timers but no input handlers — a micro-world should be human-driven, not autoplay-only.");

  const fidelityRows = c.fidelity.map((f) =>
    `<tr><td>${esc(f.aspect)}</td><td><span class="u-fid u-fid-${f.status}">${f.status}</span></td><td>${esc(f.note || "")}</td></tr>`).join("\n");
  const sourceDesc = c.mode === "range" ? `diff <code>${esc(c.range || "")}</code>` : `subsystem <code>${esc((c.paths || []).join(" "))}</code>`;
  const seedSrc = c.worldSeedSource ? `<p style="font-size:12px;color:var(--muted);margin:6px 0 0">Seed from <code>${esc(c.worldSeedSource)}</code>.</p>` : "";

  let tpl; try { tpl = fs.readFileSync(TEMPLATE, "utf8"); } catch (e) { die("cannot read template: " + e.message, 2); }
  const generatedAt = new Date().toISOString();
  let html = tpl;
  for (const [tok, val] of [
    ["{{TITLE}}", esc(c.title)], ["{{SUBTITLE}}", esc(c.subtitle || "")], ["{{SOURCE_DESC}}", sourceDesc],
    ["{{SHA}}", esc(c.sha)], ["{{MODE}}", esc(c.mode)], ["{{SLUG}}", esc(c.slug)], ["{{GENERATED_AT}}", esc(generatedAt)],
    ["{{FIDELITY_ROWS}}", fidelityRows], ["{{SEED_SOURCE}}", seedSrc],
    ["{{WORLD_SEED_JSON}}", jsonInScript(c.worldSeed)], ["{{MODEL}}", c.model_html], ["{{NOTES}}", c.notes_html || ""],
  ]) html = html.split(tok).join(val);

  const outDir = path.join(uroot(root), "worlds", c.slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  const manifest = {
    slug: c.slug, title: c.title, mode: c.mode, sha: c.sha, ref: c.ref || null,
    range: c.range || null, paths: c.paths || [], baseSha: c.baseSha || null, headSha: c.headSha || null,
    generatedAt, fidelity: c.fidelity, worldSeedSource: c.worldSeedSource || null,
    worldSeedSha: sha256(JSON.stringify(c.worldSeed)), schema: "understanding/world@1",
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const giPath = path.join(uroot(root), ".gitignore");
  const have = fs.existsSync(giPath) ? new Set(fs.readFileSync(giPath, "utf8").split("\n")) : new Set();
  for (const w of [".work/", ".nonces/"]) if (!have.has(w)) fs.appendFileSync(giPath, w + "\n");
  rewriteWorldsIndex(root, [{ slug: c.slug, stale: false, mode: c.mode }]);
  console.log(JSON.stringify({ ok: true, slug: c.slug, world: path.relative(root, path.join(outDir, "index.html")) }));
  process.exit(0);
}

die(`unknown command '${cmd || ""}'. Use: resolve | build | check`, 64);

// worlds/INDEX.md catalog with a Stale column. Title comes from each world's manifest (never parsed
// back out of the markdown), so re-runs can't corrupt it.
function rewriteWorldsIndex(root, rows) {
  const worldsDir = path.join(uroot(root), "worlds");
  fs.mkdirSync(worldsDir, { recursive: true });
  const idxPath = path.join(worldsDir, "INDEX.md");
  const header = `# Micro-worlds\n\nHuman-driven interactive models. Open any \`index.html\` in a browser.\nRun \`world.mjs check --all\` to refresh the Stale column.\n\n| World | Title | Mode | Built (sha) | Stale? |\n|---|---|---|---|---|\n`;
  const byslug = new Map();
  if (fs.existsSync(idxPath)) {
    for (const line of fs.readFileSync(idxPath, "utf8").split("\n")) {
      const m = line.match(/^\| \[`([^`]+)`\]/);
      if (m && SLUG_RE.test(m[1])) byslug.set(m[1], line);
    }
  }
  const meta = (slug) => { try { return JSON.parse(fs.readFileSync(path.join(worldsDir, slug, "manifest.json"), "utf8")); } catch { return {}; } };
  for (const r of rows) {
    const m = meta(r.slug);
    const title = (m.title || r.slug).replace(/\|/g, "\\|");
    const sha = (m.sha || "").slice(0, 12);
    byslug.set(r.slug, `| [\`${r.slug}\`](${r.slug}/index.html) | ${title} | ${m.mode || r.mode} | \`${sha}\` | ${r.stale ? "**STALE**" : "fresh"} |`);
  }
  fs.writeFileSync(idxPath, header + [...byslug.values()].join("\n") + "\n");
}
