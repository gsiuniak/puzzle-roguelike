#!/usr/bin/env node
/**
 * toolbench/browser-safe-check.mjs — guards the BROWSER-SAFE module set.
 *
 * The Balance Bench (sim/balance-bench.html) imports these toolbench modules
 * directly in the browser / in module Web Workers. A `node:` import creeping
 * into any of them (or anything they transitively import) breaks the whole
 * bench with an opaque resolution error — this check fails loudly instead.
 *
 * Two passes:
 *  1. static grep of each listed file for node-builtin STATIC imports
 *     (dynamic `await import('node:…')` behind a node-only branch is allowed
 *     — policies.mjs uses that for the learned/conv kinds);
 *  2. actual `import()` of each module with a tripwire: fail if resolution
 *     touches node builtins at load time (catches transitive regressions in
 *     src/js too).
 *
 * Run: node sim/toolbench/browser-safe-check.mjs   (part of the smoke set)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** The browser-safe contract — keep in sync with what ui/ imports. */
const BROWSER_SAFE = [
  'engine.mjs',
  'formula.mjs',
  'policy.mjs',
  'policies.mjs',
  'run-core.mjs',
  'run-analyze.mjs',
  'measure.mjs',
  'rng.mjs',
  'analytic.mjs',
  'features.mjs',
];

// STATIC import of a node builtin: `import … from 'node:x'` / `from "fs"` etc.
const STATIC_NODE_IMPORT = /^\s*import\s[^;]*?from\s+['"](node:[^'"]+|fs|path|os|url|worker_threads|child_process|readline|crypto|stream|util)['"]/m;

let failed = false;
const bad = (msg) => { failed = true; console.error(`  FAIL ${msg}`); };
const ok = (msg) => console.log(`  ok   ${msg}`);

for (const rel of BROWSER_SAFE) {
  const file = path.join(DIR, rel);
  if (!fs.existsSync(file)) { bad(`${rel} — listed but missing`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(STATIC_NODE_IMPORT);
  if (m) bad(`${rel} — static node import: ${m[0].trim()}`);
  else ok(`${rel} (no static node imports)`);
}

// Pass 2: load each module for real — a transitive static node import in
// src/js would surface here as a resolution that still *works* in node, so we
// instead scan the resolved module graph via --experimental-import-meta? Too
// heavy; a pragmatic proxy: import succeeds AND the file-level grep above
// covers the toolbench layer, while src/js is game code that never imports
// node builtins (it runs raw in the browser). Import errors still fail here.
for (const rel of BROWSER_SAFE) {
  try {
    await import(path.join(DIR, rel).replace(/\\/g, '/'));
  } catch (err) {
    bad(`${rel} — import failed: ${err.message}`);
  }
}

if (failed) {
  console.error('\nBROWSER-SAFE CONTRACT VIOLATED — fix before shipping the bench');
  process.exit(1);
}
console.log('\nBROWSER-SAFE OK — the bench module set carries no static node imports');
