/**
 * toolbench/policies.mjs — serializable policy SPEC → live policy (BROWSER-SAFE).
 *
 * Extracted from pool-worker.mjs (2026-07-08, Balance Bench v2 Phase 0) so both
 * the node worker pool AND the browser bench worker resolve specs through the
 * same code. A spec is a plain-JSON value that travels across worker
 * boundaries:
 *
 *   null                              → shipped greedy AI ("Simple")
 *   { kind:'formula', weights, opts } → deterministic formula policy ("Hard" —
 *                                       the deployment/measurement player)
 *   { kind:'value',   weights, opts } → preview-search value policy (experiments)
 *   { kind:'learned', model,   opts } → learned-V search policy   (NODE-ONLY)
 *   { kind:'conv',    model,   opts } → conv-net search policy    (NODE-ONLY)
 *
 * The node-only kinds hide behind dynamic imports (learn.mjs/nn.mjs pull in
 * node:fs) — they only load if actually selected, so this module itself stays
 * importable in the browser.
 */

import { makeValuePolicy } from './policy.mjs';
import { makeFormulaPolicy } from './formula.mjs';

/** Resolve one spec. Async because the node-only kinds dynamic-import. */
export async function resolvePolicySpec(spec) {
  if (spec == null) return null;
  if (spec.kind === 'formula') return makeFormulaPolicy(spec.weights || {}, spec.opts || {});
  if (spec.kind === 'value') return makeValuePolicy(spec.weights || {}, spec.opts || {});
  if (spec.kind === 'learned') {
    const { makeLearnedPolicy } = await import('./learn.mjs');
    return makeLearnedPolicy(spec.model, spec.opts || {});
  }
  if (spec.kind === 'conv') {
    const { makeConvPolicy, loadConvModel } = await import('./nn.mjs');
    return makeConvPolicy(loadConvModel(spec.model), spec.opts || {});
  }
  throw new Error(`unknown policy spec kind "${spec && spec.kind}"`);
}

/**
 * A per-context resolver with a ref cache — the worker-side pattern: specs are
 * registered once under string refs, tasks name the ref.
 */
export function makePolicyResolver(specsByRef = {}) {
  const cache = new Map();
  return async function resolve(ref) {
    if (ref == null) return null;
    if (cache.has(ref)) return cache.get(ref);
    const pol = await resolvePolicySpec(specsByRef[ref] ?? null);
    cache.set(ref, pol);
    return pol;
  };
}
