/**
 * build.js — Zero-dependency production build script.
 *
 * Produces a single self-contained dist/index.html with:
 *   - All ES modules concatenated in dependency order (no bundler needed)
 *   - All image assets inlined as base64 data URLs
 *   - Font inlined as base64 data URL
 *   - CSS inlined (already inline in source)
 *
 * Usage:  node scripts/build.js   or   npm run build
 * Output: dist/index.html  (self-contained, open directly or serve)
 *
 * No npm install required — uses only Node.js built-in modules.
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const HTML_SRC = path.join(SRC, 'index.html');
const JS_ENTRY = path.join(SRC, 'js', 'main.js');
const JS_DIR = path.join(SRC, 'js');
const ASSETS_SPRITES = path.join(SRC, 'assets', 'sprites');
const ASSETS_FONTS = path.join(SRC, 'assets', 'fonts');
const FONT_FILE = 'MarcellusSC-Regular.ttf';

// ── Helpers ────────────────────────────────────────────────

/** Recursively collect all .png files under a directory */
function collectPngFiles(dir, base) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPngFiles(full, base));
    } else if (entry.name.endsWith('.png')) {
      results.push({
        absolute: full,
        relative: path.relative(base, full).replace(/\\/g, '/'),
      });
    }
  }
  return results;
}

/** Read a binary file and return its base64 data URL */
function fileToDataUrl(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  const b64 = buffer.toString('base64');
  return `data:${mimeType};base64,${b64}`;
}

// ── Module graph builder ───────────────────────────────────

/**
 * Parse import statements from a JS source file.
 * Returns array of { localName, sourcePath } objects.
 * Handles:
 *   import X from './path.js'
 *   import X, { A, B } from './path.js'
 *   import { A, B } from './path.js'
 */
function parseImports(source, fileDir) {
  const result = [];
  const importRegex = /^import\s+(?:(\w+)\s*,\s*)?(?:\{([^}]+)\})?\s*(?:from\s+)?['"]([^'"]+)['"]/gm;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const defaultName = match[1] || null;
    const namedStr = match[2] || '';
    const sourcePath = match[3];

    // Only handle relative imports (skip bare specifiers if any)
    if (sourcePath.startsWith('.')) {
      // Resolve relative path to absolute
      const resolved = path.resolve(fileDir, sourcePath);
      const names = [];
      if (defaultName) names.push(defaultName);
      if (namedStr) {
        const namedList = namedStr.split(',').map(s => s.trim()).filter(Boolean);
        names.push(...namedList);
      }
      result.push({ names, sourcePath: resolved });
    }
  }
  return result;
}

/**
 * Build a dependency graph from the entry point.
 * Returns an array of absolute file paths in dependency order (topsort).
 */
function buildModuleOrder(entryFile) {
  const visited = new Set();
  const order = [];

  function visit(filePath) {
    // Normalize path: resolve relative segments (.., .) without touching the filesystem
    const normalized = path.resolve(filePath);
    if (visited.has(normalized)) return;
    visited.add(normalized);

    const source = fs.readFileSync(filePath, 'utf-8');
    const fileDir = path.dirname(filePath);
    const imports = parseImports(source, fileDir);

    // Visit dependencies first (topological order)
    for (const imp of imports) {
      try {
        visit(imp.sourcePath);
      } catch (e) {
        console.warn(`  Warning: could not resolve import "${imp.sourcePath}" from ${filePath}`);
      }
    }

    // Add this file after its dependencies
    order.push(normalized);
  }

  visit(entryFile);
  return order;
}

/**
 * Transform a module source: strip import/export statements
 * so it can be concatenated into a single scope.
 */
function transformModule(source) {
  const lines = source.split('\n');
  const out = [];

  for (const line of lines) {
    // Skip import lines entirely
    if (/^\s*import\s+/.test(line)) {
      continue;
    }

    // Transform export lines
    if (/^\s*export\s+default\s+class\s/.test(line)) {
      // "export default class ClassName {" → "class ClassName {"
      out.push(line.replace(/export\s+default\s+/, ''));
    } else if (/^\s*export\s+default\s+/.test(line)) {
      // "export default variableName;" → just remove the export prefix
      out.push(line.replace(/export\s+default\s+/, ''));
    } else if (/^\s*export\s+const\s+/.test(line)) {
      // "export const NAME = ..." → "const NAME = ..."
      out.push(line.replace(/export\s+/, ''));
    } else if (/^\s*export\s+function\s+/.test(line)) {
      // "export function name()" → "function name()"
      out.push(line.replace(/export\s+/, ''));
    } else if (/^\s*export\s*\{/.test(line)) {
      // "export { X, Y };" → skip (not used in this project)
      continue;
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

// ── Step 1: Build module dependency graph ─────────────────
console.log('[1/5] Building module dependency graph...');

const moduleOrder = buildModuleOrder(JS_ENTRY);
console.log(`  Found ${moduleOrder.length} modules in dependency order`);

// ── Step 2: Concatenate and transform modules ─────────────
console.log('[2/5] Concatenating modules...');

const moduleSources = moduleOrder.map(filePath => {
  const source = fs.readFileSync(filePath, 'utf-8');
  const transformed = transformModule(source);
  const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  return `\n// ── ${relPath} ──────────────────────────────────────────────\n${transformed}`;
});

let bundledJs = `(function() {\n'use strict';\n${moduleSources.join('\n')}\n})();\n`;
console.log(`  Concatenated JS: ${(bundledJs.length / 1024).toFixed(1)} KB`);

// ── Step 3: Inline image assets as base64 ─────────────────
console.log('[3/5] Inlining image assets as base64 data URLs...');

const pngFiles = collectPngFiles(ASSETS_SPRITES, SRC);

// Build map: relative-path-from-src → data URL
// e.g. "assets/sprites/tiles/red_tile.png" → "data:image/png;base64,..."
const assetReplacements = new Map();

for (const file of pngFiles) {
  const relFromSrc = file.relative;
  const dataUrl = fileToDataUrl(file.absolute, 'image/png');
  assetReplacements.set(relFromSrc, dataUrl);
}
console.log(`  Found ${pngFiles.length} PNG files`);

// Replace all asset paths in the bundled JS with data URLs
let replacedJs = bundledJs;
let replaceCount = 0;
for (const [relPath, dataUrl] of assetReplacements) {
  const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'g');
  const before = replacedJs.length;
  replacedJs = replacedJs.replace(regex, dataUrl);
  if (replacedJs.length !== before) {
    replaceCount++;
  }
}
console.log(`  Replaced ${replaceCount} asset paths with data URLs`);
console.log(`  Final JS: ${(replacedJs.length / 1024).toFixed(1)} KB`);

// ── Step 4: Inline font ────────────────────────────────────
console.log('[4/5] Inlining font...');

const fontPath = path.join(ASSETS_FONTS, FONT_FILE);
const fontDataUrl = fileToDataUrl(fontPath, 'font/truetype');
console.log(`  Font data URL: ${(fontDataUrl.length / 1024).toFixed(1)} KB`);

// ── Step 5: Generate dist/index.html ───────────────────────
console.log('[5/5] Generating dist/index.html...');

let html = fs.readFileSync(HTML_SRC, 'utf-8');

// Replace the module script tag with the inlined IIFE bundle
html = html.replace(
  /<script\s+type="module"\s+src="js\/main\.js"><\/script>/,
  `<script>\n${replacedJs}\n</script>`
);

// Replace the @font-face url with the data URL
html = html.replace(
  /url\(['"]?assets\/fonts\/MarcellusSC-Regular\.ttf['"]?\)/,
  `url(${fontDataUrl})`
);

// Write output
fs.mkdirSync(DIST, { recursive: true });
const outPath = path.join(DIST, 'index.html');
fs.writeFileSync(outPath, html, 'utf-8');

const outSize = fs.statSync(outPath).size;
console.log(`\n✅ Build complete!`);
console.log(`   Output: dist/index.html  (${(outSize / 1024).toFixed(1)} KB)`);
console.log(`   Run with:  npx serve dist`);
console.log(`   Or open:   dist/index.html  directly in browser`);
console.log(`\n   Development files unchanged — continue using src/index.html`);
