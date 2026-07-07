#!/usr/bin/env node
/*
 * ci-gate.mjs — forge-neutral CI entry point for the understanding gate (increment 4).
 *
 * Bring-your-own-CI contract: run this in a PR check; exit 0 = allowed, non-zero = block. Works on
 * any forge (a GitHub Action template ships in templates/understanding-quiz.yml; GitLab/Gitea just
 * call the script and honor the exit code). Default is OFF — with no config, or gate.enabled != true,
 * it exits 0, so adding the check never surprises a repo.
 *
 * It verifies that the PR's consequential change has a valid, fresh understanding pass, and — when
 * gate.prCheck is on — that the certifier is NOT the author (author ≠ certifier).
 *
 * Usage:
 *   ci-gate.mjs [--base <ref>] [--head <ref>] [--author <email|name>] [--root <dir>]
 *     --base    merge target (default: gate.base in config, else origin/main)
 *     --head    PR head    (default: HEAD)
 *     --author  identity to exclude as certifier (default: the head commit's author email)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(__dirname, "gate.mjs");
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def; }
const root = path.resolve(arg("--root", process.cwd()));
function git(args) { try { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); } catch { return ""; } }

const cfgPath = path.join(root, ".understanding", "config.json");
let cfg = {};
if (fs.existsSync(cfgPath)) { try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) { console.error("ci-gate: config.json unreadable: " + e.message); process.exit(2); } }
const gate = cfg.gate || {};
const on = gate.enabled === true || gate.enabled === "true";
if (!on) { console.log("understanding: gate disabled (no opt-in) — skipping."); process.exit(0); }

const base = arg("--base", gate.base || "origin/main");
const head = arg("--head", "HEAD");
const paths = Array.isArray(gate.paths) ? gate.paths : [];
const prCheck = gate.prCheck === true || gate.prCheck === "true";
const author = arg("--author", git(["log", "-1", "--format=%an <%ae>", head]));
const range = `${base}..${head}`;
if (prCheck && !author) { console.error("ci-gate: prCheck is on but the change's author identity couldn't be derived — refusing (fail-closed). Pass --author explicitly."); process.exit(2); }
console.log(`understanding: gate on — range ${range}, prCheck=${prCheck}, paths=[${paths.join(",")}]`);

// consequential-scope filter: if paths are configured and the change doesn't touch them, nothing to gate.
if (paths.length) {
  const touched = git(["diff", "--name-only", range, "--", ...paths]);
  if (!touched) { console.log(`understanding: change does not touch gated paths (${paths.join(" ")}) — skipping.`); process.exit(0); }
}

const gateArgs = ["check", "--root", root, "--range", range];
if (prCheck && author) gateArgs.push("--certifier-not", author);   // must come BEFORE the pathspec `--`
if (paths.length) gateArgs.push("--", ...paths);

let out = "", code = 0;
try { out = execFileSync("node", [GATE, ...gateArgs], { cwd: root, encoding: "utf8" }); }
catch (e) { out = String(e.stdout || ""); code = e.status || 1; }
let res = {};
try { res = JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "{}"); } catch {}

if (code === 0 && res.ok) {
  console.log(`understanding: PASS — ${range}${res.who ? " · certified by " + res.who : ""}`);
  console.log("  note: confirms a fresh pass naming a distinct certifier — it does NOT cryptographically re-verify the pass (the verifying nonce is local). Review .understanding/passes/** in the PR like any other change.");
  process.exit(0);
}
const reason = res.reason || "no-pass";
console.error(`understanding: BLOCK — ${reason} for consequential change in ${range}${paths.length ? " (paths: " + paths.join(" ") + ")" : ""}`);
if (reason === "self-certified") {
  console.error(`  ${res.who} both authored and certified this change. Author ≠ certifier: a different teammate must build the explainer and pass its quiz.`);
} else if (reason === "stale") {
  console.error("  A pass exists but the code moved since — regenerate the explainer and re-grade for the current range.");
} else {
  console.error(`  Build an explainer and pass its quiz:  /explain-diff ${range}  →  /understanding-gate --grade <blob>`);
}
process.exit(1);
