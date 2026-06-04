/**
 * Metrics.js — opt-in playtest telemetry.
 *
 * Disabled by default. Enable by opening the game with a `?metrics` URL flag:
 *   http://localhost:8080/src/index.html?metrics
 *
 * When enabled, `Metrics.recordBattle(...)` POSTs one JSON line per battle to a
 * collector endpoint (default same-origin `/__metrics`, served by sim/serve.mjs),
 * which appends it to sim/out/playtest.jsonl for offline analysis
 * (`node sim/analyze-playtest.mjs`). Use a different collector with
 * `?metrics=http://host:port/__metrics`.
 *
 * Fire-and-forget and fully guarded — never throws into gameplay, and is a no-op
 * when the flag is absent, so it's safe to leave the recordBattle() call in.
 */

const params = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
const ENABLED = params.has('metrics');
const RAW = params.get('metrics');
const ENDPOINT = (RAW && /^https?:\/\//.test(RAW)) ? RAW : '/__metrics';

// A per-page-load id so multiple runs in one session can be grouped/separated.
const SESSION = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function post(obj) {
  if (!ENABLED) return;
  try {
    const line = JSON.stringify({ t: Date.now(), session: SESSION, ...obj });
    // text/plain keeps it a "simple" request (no CORS preflight); keepalive lets
    // it survive a scene transition.
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: line, keepalive: true })
      .catch(() => {});
  } catch (_) { /* never break gameplay */ }
}

const Metrics = {
  enabled: ENABLED,

  /** Generic event. */
  record(event) { post(event); },

  /**
   * Record the outcome of a battle. All fields optional/defensive.
   * @param {object} d — battle snapshot (see BattleScene call site)
   */
  recordBattle(d) {
    if (!ENABLED) return;
    post({ kind: 'battle', ...d });
    if (typeof console !== 'undefined') console.log('[Metrics] battle recorded:', d.result, `floor ${d.floor}`, d.enemyId);
  },
};

export default Metrics;
