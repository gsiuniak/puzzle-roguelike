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
import goresnoutTrackers from './goresnoutTrackers.js';
import abomination from './abomination.js';
import thrall from './thrall.js';
import sanguinePhoenix from './sanguinePhoenix.js';
import sanguineEgg from './sanguineEgg.js';
import lordMalakor from './lordMalakor.js';

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
  goresnoutTrackers,
  abomination,
  thrall,
  sanguinePhoenix,
  sanguineEgg, // never spawns (floors: []) — transform target for the Phoenix
  lordMalakor,
];

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
  goresnoutTrackers,
  abomination,
  thrall,
  sanguinePhoenix,
  sanguineEgg,
  lordMalakor,
};
export default ACT1_ENEMIES;
