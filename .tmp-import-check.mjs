// Temporary headless smoke check (deleted after use).
const { default: BattleController } = await import('./src/js/game/BattleController.js');
const { default: BoardModel } = await import('./src/js/game/BoardModel.js');
const sim = await import('./src/js/game/BoardSimulator.js');
const advisor = await import('./src/js/game/MoveAdvisor.js');
const { default: overrides } = await import('./src/js/game/enemyAiOverrides.js');

const mkSide = (name, skills) => ({
  name, className: 'test', level: 1,
  hp: 30, maxHp: 30, attack: 3, magic: 1, armor: 0,
  mana: {}, portrait: '',
  skills: skills || [
    { id: 'bash', name: 'Bash', cost: { red: 4 }, effects: [{ effectType: 'damage', damage: { amount: 5 } }] },
    { id: 'zap', name: 'Zap', cost: { blue: 3 }, effects: [{ effectType: 'damage', damage: { amount: 3 } }] },
  ],
  relics: [],
});

// ── 1. BoardSimulator on a live battle board ──
const c = new BattleController(mkSide('Hero'), mkSide('Goblin'));
for (let i = 0; i < 200; i++) c.update(16);
if (c.state !== 'PLAYER_TURN') throw new Error('expected PLAYER_TURN, got ' + c.state);

const gridBefore = JSON.stringify(c.board.toJSON());
const moves = sim.enumerateMoves(c.board, c.playerState, { samples: 3 });
console.log('legal moves found:', moves.length);
if (moves.length === 0) throw new Error('no legal moves on a fresh board (unexpected)');
const m0 = moves[0];
console.log('sample outcome — guaranteed:', JSON.stringify({
  mana: m0.guaranteed.mana, skull: m0.guaranteed.skullDamage,
  extra: m0.guaranteed.extraTurn, cascades: m0.guaranteed.cascades,
}));
console.log('sample outcome — expected:', JSON.stringify({
  manaTotal: +m0.expected.manaTotal.toFixed(2),
  skull: +m0.expected.skullDamage.toFixed(2),
  extraChance: m0.expected.extraTurnChance,
  cascades: +m0.expected.cascades.toFixed(2),
}));
if (JSON.stringify(c.board.toJSON()) !== gridBefore) throw new Error('SIMULATOR MUTATED THE LIVE BOARD');
console.log('live board untouched: true');

// Every guaranteed outcome must have at least 1 cascade and 3+ tiles destroyed.
for (const mv of moves) {
  if (mv.guaranteed.cascades < 1 || mv.guaranteed.tilesDestroyed < 3) {
    throw new Error('invalid guaranteed outcome: ' + JSON.stringify(mv.guaranteed));
  }
}
console.log('all guaranteed outcomes sane: true');

// ── 2. MoveAdvisor ranking + hint API ──
c.playerState.mana.red = 2; // partway to Bash → red should be "needed"
const ranked = c.getRankedMoves({ samples: 3 });
console.log('ranked moves:', ranked.length, 'top score:', +ranked[0].score.toFixed(1));
console.log('top breakdown:', JSON.stringify(Object.fromEntries(
  Object.entries(ranked[0].breakdown).map(([k, v]) => [k, +v.toFixed(1)]))));
const hint = c.getSuggestedMove({ samples: 3 });
if (!hint || hint.swap == null) throw new Error('getSuggestedMove returned nothing');
console.log('hint swap:', JSON.stringify(hint.swap));
// Hint must be an actual valid move.
const validKeys = new Set(c.board.getValidSwaps().map(s => `${s.col1},${s.row1},${s.col2},${s.row2}`));
if (!validKeys.has(`${hint.swap.col1},${hint.swap.row1},${hint.swap.col2},${hint.swap.row2}`)) {
  throw new Error('hint swap is not a valid board swap');
}
console.log('hint is a valid swap: true');

// scoring monotonicity spot-check: ranked is sorted desc.
for (let i = 1; i < ranked.length; i++) {
  if (ranked[i].score > ranked[i - 1].score + 1e-9) throw new Error('ranking not sorted');
}
console.log('ranking sorted: true');

// ── 3. smart_matcher enemy adapter (registered but unused by any enemy) ──
const action = overrides.smart_matcher({
  enemy: c.enemyState,
  player: c.playerState,
  board: c.board,
  standardAI: { findBestSkill: () => null, findBestSwap: () => null },
});
if (!action || action.action !== 'swap' || !action.swap) throw new Error('smart_matcher did not return a swap');
console.log('smart_matcher swap:', JSON.stringify(action.swap));
// And when a skill is available it must defer (return null → standard AI).
const deferred = overrides.smart_matcher({
  enemy: c.enemyState, player: c.playerState, board: c.board,
  standardAI: { findBestSkill: () => ({ id: 'x' }), findBestSwap: () => null },
});
if (deferred !== null) throw new Error('smart_matcher must defer when a skill is castable');
console.log('smart_matcher defers to skills: true');

// ── 4. Full-battle churn: let the AI sides play several turns headlessly ──
const c3 = new BattleController(mkSide('Hero'), mkSide('Goblin'));
let frames = 0;
while (c3.state !== 'GAME_OVER' && frames < 20000) {
  c3.update(16);
  frames++;
  if (c3.state === 'PLAYER_TURN') {
    // Player plays the advisor's best move each turn (exercises swap flow too).
    const best = c3.getSuggestedMove({ samples: 1, lookahead: false });
    if (best) c3.tryPlayerSwap(best.swap.col1, best.swap.row1, best.swap.col2, best.swap.row2);
    else break;
  }
}
console.log('churn result — frames:', frames, 'state:', c3.state,
  'hp:', c3.playerState.hp, '/', c3.enemyState.hp);

console.log('SMOKE_OK');
