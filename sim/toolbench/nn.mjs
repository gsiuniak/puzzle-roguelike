/**
 * toolbench/nn.mjs — hand-rolled inference for the SPATIAL value net (Phase B).
 *
 * The net is trained in Python/PyTorch on the GPU (python/train_td_conv.py)
 * and exported as plain-JSON weights; this module runs the identical forward
 * pass in JS (zero deps) so the search policy can use it in-engine:
 *
 *   input  = one-hot board planes [TILE_PLANES × 8 × 8] + flat features [F]
 *   conv1  3×3 pad1 → ReLU → conv2 3×3 pad1 → ReLU → flatten
 *   concat flat features → fc1 → ReLU → fc2 → sigmoid = P(win)
 *
 * Contract: layer shapes/order and TILE_INDEX come from the exporter — verify
 * with `node sim/toolbench/nn.mjs parity <model.json> <parity.json>` (the
 * trainer writes parity vectors; JS must match Python to ~1e-4).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featurize, boardTensor, FEATURE_NAMES, TILE_PLANES } from './features.mjs';
import { makeSearchPolicy } from './policy.mjs';

const SIZE = 8;

export function loadConvModel(file) {
  const m = typeof file === 'string' ? JSON.parse(fs.readFileSync(file, 'utf8')) : file;
  if (m.type !== 'conv') throw new Error('not a conv model');
  if (m.tilePlanes !== TILE_PLANES) throw new Error(`tilePlanes mismatch: model ${m.tilePlanes}, featurizer ${TILE_PLANES}`);
  if (m.flatDim !== FEATURE_NAMES.length) throw new Error(`flat-feature mismatch: model ${m.flatDim}, featurizer ${FEATURE_NAMES.length}`);
  return m;
}

/** b64 (64 tile indices) → one-hot planes as Float32Array [P*64], plane-major. */
export function planesFromBoard(b64) {
  const planes = new Float32Array(TILE_PLANES * SIZE * SIZE);
  for (let i = 0; i < b64.length; i++) planes[b64[i] * 64 + i] = 1;
  return planes;
}

/** 3×3 pad-1 conv over 8×8, plane-major in/out. w: [outC][inC*9], b: [outC]. */
function conv3x3(input, inC, w, b, outC, relu) {
  const out = new Float32Array(outC * 64);
  for (let oc = 0; oc < outC; oc++) {
    const wRow = w[oc];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let acc = b[oc];
        for (let ic = 0; ic < inC; ic++) {
          const base = ic * 64;
          const wBase = ic * 9;
          for (let ky = -1; ky <= 1; ky++) {
            const yy = y + ky;
            if (yy < 0 || yy >= SIZE) continue;
            for (let kx = -1; kx <= 1; kx++) {
              const xx = x + kx;
              if (xx < 0 || xx >= SIZE) continue;
              acc += input[base + yy * SIZE + xx] * wRow[wBase + (ky + 1) * 3 + (kx + 1)];
            }
          }
        }
        out[oc * 64 + y * SIZE + x] = relu && acc < 0 ? 0 : acc;
      }
    }
  }
  return out;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Forward pass: b64 board ints + flat feature array → P(win). */
export function convPredict(model, b64, flat) {
  const planes = planesFromBoard(b64);
  const h1 = conv3x3(planes, model.tilePlanes, model.conv1.w, model.conv1.b, model.conv1.w.length, true);
  const h2 = conv3x3(h1, model.conv1.w.length, model.conv2.w, model.conv2.b, model.conv2.w.length, true);
  // fc1 over [flatten(h2) ++ flat]
  const n2 = h2.length;
  const fc1 = model.fc1;
  const hidden = new Float32Array(fc1.b.length);
  for (let j = 0; j < fc1.b.length; j++) {
    let acc = fc1.b[j];
    const wRow = fc1.w[j];
    for (let i = 0; i < n2; i++) acc += wRow[i] * h2[i];
    for (let i = 0; i < flat.length; i++) acc += wRow[n2 + i] * flat[i];
    hidden[j] = acc < 0 ? 0 : acc;
  }
  let z = model.fc2.b[0];
  for (let j = 0; j < hidden.length; j++) z += model.fc2.w[0][j] * hidden[j];
  return sigmoid(z);
}

/** Search-policy evaluator backed by the conv net (mode 'replace' — an
 *  afterstate V already encodes the future). */
export function makeConvPolicy(model, opts = {}) {
  const evaluator = (battle, c, opp, action, preview, self, pOpp, extraTurn) =>
    convPredict(model, boardTensor(preview), featurize(preview, self, pOpp, extraTurn ? 1 : 0));
  evaluator.mode = 'replace';
  return makeSearchPolicy(evaluator, opts);
}

/* ── CLI: parity check vs the Python trainer's exported test vectors ── */
async function main() {
  const [cmd, modelFile, parityFile] = process.argv.slice(2);
  if (cmd !== 'parity' || !modelFile || !parityFile) {
    console.log('usage: node sim/toolbench/nn.mjs parity <model.json> <parity.json>');
    process.exitCode = 1;
    return;
  }
  const model = loadConvModel(modelFile);
  const vectors = JSON.parse(fs.readFileSync(parityFile, 'utf8'));
  let worst = 0;
  for (const v of vectors) {
    const p = convPredict(model, v.b, v.f);
    worst = Math.max(worst, Math.abs(p - v.v));
    console.log(`js=${p.toFixed(6)} py=${v.v.toFixed(6)} Δ=${Math.abs(p - v.v).toExponential(2)}`);
  }
  console.log(worst < 1e-4 ? `PARITY OK (worst Δ=${worst.toExponential(2)})` : `PARITY FAIL (worst Δ=${worst.toExponential(2)})`);
  if (worst >= 1e-4) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
