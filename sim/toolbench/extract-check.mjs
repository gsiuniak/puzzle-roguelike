/** extract-check.mjs — extract the toolbench HTML's inline module script and syntax-check it. */
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(new URL('../balance-toolbench.html', import.meta.url), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('no module script found'); process.exit(1); }
const tmp = new URL('./_ui-script-check.mjs', import.meta.url);
writeFileSync(tmp, m[1]);
try {
  // compile without executing: dynamic import would execute — instead use vm.SourceTextModule if available,
  // else fall back to a parse via new Function on a transformed source (strip import/await).
  const vm = await import('node:vm');
  if (vm.SourceTextModule) {
    new vm.SourceTextModule(m[1], { identifier: 'ui' });
    console.log('UI SCRIPT PARSE OK (vm.SourceTextModule)');
  } else {
    console.log('vm.SourceTextModule unavailable (run node with --experimental-vm-modules)');
    process.exit(2);
  }
} catch (e) {
  console.error('SYNTAX ERROR:', e.message);
  process.exit(1);
}
