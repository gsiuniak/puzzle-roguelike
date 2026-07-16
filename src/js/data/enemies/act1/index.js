/**
 * Act 1 enemy roster. Add new Act 1 enemies here.
 */
import goblin from './goblin.js';
// import orc from './orc.js';
// import goblinSapper from './goblinSapper.js'; // disabled 2026-07-06 — the bomb-race is a near-binary RNG check that skews balance measurement & AI training; re-enable after a redesign
import acolyte from './acolyte.js';
// import shadowWeaver from './shadowWeaver.js';
import cyclops from './cyclops.js';
// import stoneGargoyle from './stoneGargoyle.js'; // disabled — no portrait in the new sheet
import orcTaskmaster from './orcTaskmaster.js';
import chokeweed from './chokeweed.js';
import blightWarden from './blightWarden.js';
import goresnoutTrackers from './goresnoutTrackers.js';
import abomination from './abomination.js';
import marrowSentry from './marrowSentry.js';
import thrall from './thrall.js';
import sanguinePhoenix from './sanguinePhoenix.js';
import sanguineEgg from './sanguineEgg.js';
import lordMalakor from './lordMalakor.js';

/**
 * Act 1 spawn placement — floor → eligible enemy ids (THE authoritative
 * placement table). This is the AUTHORING surface for "what can appear on
 * floor N": edit a floor's array here to add/remove an encounter. Floors are
 * 1-indexed (floor 1 = first encounter, floor 10 = the boss).
 *
 * Each def's `floors` array is DERIVED from this table at module load in
 * enemies/index.js — every consumer (game + toolbench) still reads `def.floors`
 * unchanged; this map is just where placement is edited.
 *
 * Enemies intentionally absent (never spawn as an encounter): `goblin`
 * (disabled) and `sanguineEgg` (a transform-only form). Enemy `type`
 * (minion/elite/boss) still lives on each def and is matched at selection —
 * listing an elite here (e.g. sanguinePhoenix) just makes it part of that
 * floor's roster; selectEnemyForNode splits by the node's required type.
 */
const ACT1_FLOOR_SPAWNS = {
  1:  ['acolyte', 'thrall'],
  2:  ['acolyte', 'thrall'],
  3:  ['thrall', 'chokeweed'],
  4:  ['chokeweed', 'marrow_sentry', 'cyclops'],
  5:  ['chokeweed', 'goresnout_trackers', 'blight_warden', 'marrow_sentry', 'cyclops', 'blight_warden', 'sanguinePhoenix'],
  6:  ['goresnout_trackers', 'blight_warden', 'marrow_sentry', 'cyclops', 'blight_warden', 'sanguinePhoenix'],
  7:  ['goresnout_trackers', 'abomination', 'blight_warden', 'marrow_sentry', 'cyclops', 'blight_warden', 'sanguinePhoenix'],
  8:  [  'sanguinePhoenix', 'blight_warden'],
  9:  ['goresnout_trackers', 'abomination', 'blight_warden', 'sanguinePhoenix'],
  10: ['lordMalakor'],
};

/** All Act 1 enemy definitions. */
const ACT1_ENEMIES = [
  goblin,
  // orc,
  // goblinSapper, // disabled — see import note
  acolyte,
  // shadowWeaver,
  cyclops,
  // stoneGargoyle,
  orcTaskmaster,
  chokeweed,
  blightWarden,
  goresnoutTrackers,
  abomination,
  marrowSentry,
  thrall,
  sanguinePhoenix,
  sanguineEgg, // never spawns (floors: []) — transform target for the Phoenix
  lordMalakor,
];

export { ACT1_FLOOR_SPAWNS };
export {
  goblin,
  // orc,
  // goblinSapper, // disabled — see import note
  acolyte,
  // shadowWeaver,
  cyclops,
  // stoneGargoyle,
  orcTaskmaster,
  chokeweed,
  blightWarden,
  goresnoutTrackers,
  abomination,
  marrowSentry,
  thrall,
  sanguinePhoenix,
  sanguineEgg,
  lordMalakor,
};
export default ACT1_ENEMIES;
