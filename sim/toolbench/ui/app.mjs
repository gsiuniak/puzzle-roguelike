/**
 * toolbench/ui/app.mjs — Balance Bench boot: nav rail, tab router, error screen.
 * Views are lazy singletons; the champion weights fetch kicks off first so the
 * "Hard" AI is ready by the first weigh.
 */

import { $, $$, h, esc } from './util.mjs';
import { store, initChampion, champion } from './store.mjs';

const root = document.getElementById('root');

/* Surface uncaught errors on the page (workers report through their promises;
   this catches main-thread/module failures that would otherwise be silent). */
function errBanner(msg) {
  let box = document.getElementById('errlog');
  if (!box) {
    box = document.createElement('div');
    box.id = 'errlog';
    box.style.cssText = 'position:fixed;bottom:8px;right:8px;max-width:480px;z-index:99;background:#2a1414;border:1px solid #5c2626;border-radius:8px;padding:8px 12px;font:11px monospace;color:#f0c0c0;white-space:pre-wrap';
    document.body.appendChild(box);
  }
  box.textContent += msg + '\n';
}
window.addEventListener('error', (e) => errBanner(`[error] ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => errBanner(`[reject] ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));

export async function boot() {
  let views;
  try {
    await initChampion(); // non-fatal on failure — noted in the AI selector
    const [bench, compare, floors, runs, weave, designer, audit, reference] = await Promise.all([
      import('./views/bench.mjs'), import('./views/compare.mjs'), import('./views/floors.mjs'),
      import('./views/runs.mjs'), import('./views/weave.mjs'), import('./views/designer.mjs'),
      import('./views/audit.mjs'), import('./views/reference.mjs'),
    ]);
    views = {
      bench: bench.benchView, compare: compare.compareView, floors: floors.floorsView,
      runs: runs.runsView, weave: weave.weaveView, designer: designer.designerView,
      audit: audit.auditView, reference: reference.referenceView,
    };
  } catch (err) {
    root.innerHTML = `<div class="err"><h2>Could not load the game source</h2>
      <p>The bench imports the LIVE game modules and data catalogs, so it must be served over http
      from the repo root (file:// blocks ES-module imports and workers).</p>
      <pre class="code">cd ~/test/game/gems
node sim/toolbench/serve.mjs
# then open  http://localhost:8123/sim/balance-bench.html</pre>
      <p class="hint">${esc(String(err && err.stack || err))}</p></div>`;
    throw err;
  }

  const TABS = [
    ['bench', '⚖ Bench'], ['compare', '⇄ Compare'], ['floors', '∿ Floors'],
    ['runs', '☰ Runs'], ['weave', '✦ Weave'], ['designer', '✎ Designer'],
    ['audit', '☑ Audit'], ['reference', '§ Reference'],
  ];
  root.appendChild(h(`<div class="app">
    <nav>
      <div class="brand"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-4px;margin-right:6px"><path d="M12 3v18M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7zM17 7l-3 6a3 3 0 0 0 6 0L17 7zM8 21h8"/></svg>Balance Bench</div>
      <div class="sub">gems · measured on the live engine</div>
      ${TABS.map(([id, label]) => `<button data-tab="${id}">${label}</button>`).join('')}
      <div class="foot">real BoardModel + MatchResolver<br>champion AI · paired seeds<br>
        <span data-champ class="hint"></span><br>
        <a href="../docs/balance-bench-v2-design.md">design doc</a></div>
    </nav>
    <main id="main"></main>
  </div>`));

  $('[data-champ]', root).textContent = champion.weights
    ? 'champion weights loaded ✓' : ('⚠ champion weights: ' + (champion.error || 'missing'));

  const main = $('#main', root);
  const built = {};
  let activeTab = null;
  function switchTab(id) {
    if (activeTab && built[activeTab] && built[activeTab].onHide) built[activeTab].onHide();
    activeTab = id;
    $$('nav button', root).forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    if (!built[id]) built[id] = views[id]();
    main.innerHTML = '';
    main.appendChild(built[id].el);
    built[id].onShow && built[id].onShow();
    const url = new URL(location.href);
    url.searchParams.set('tab', id);
    history.replaceState(null, '', url);
  }
  $$('nav button', root).forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  const params = new URLSearchParams(location.search);
  // scripted checks: ?ai=simple|hard|custom|value forces the player AI
  if (params.get('ai')) store.cfg.ai.player = params.get('ai');
  switchTab(TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'bench');
}

boot();
