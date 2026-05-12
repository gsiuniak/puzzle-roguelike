/**
 * characterSelectDefinitions.js — static mapping of selectable characters
 * for the CharacterSelectScene.
 *
 * Each entry references gameplay data from mockCharacter.js and adds
 * display-only metadata (splash art key, portrait key, order, enabled state).
 *
 * Adding a new character means:
 *   1. Add the gameplay definition in mockCharacter.js
 *   2. Add a corresponding entry in the array below with the correct asset keys
 *   3. Register the new splash/portrait assets in main.js ASSET_MAP
 *
 * The scene renders from this array — no hardcoded Warrior/Mage logic.
 */

import { warriorCharacter, mageCharacter } from './mockCharacter.js';

const characterSelectDefinitions = [
  {
    id: 'warrior',
    name: warriorCharacter.name,
    className: warriorCharacter.className,
    /** Asset key for the portrait icon shown in the heroes row */
    portraitKey: 'portrait_warrior',
    /** Asset key for the full-screen splash background */
    splashKey: 'character_select_splash_warrior',
    /** Reference to the gameplay character data (hp, mana, skills, etc.) */
    characterData: warriorCharacter,
    /** Display order in the heroes row (lower = leftmost) */
    order: 0,
    /** Whether this character is selectable */
    enabled: true,
  },
  {
    id: 'mage',
    name: mageCharacter.name,
    className: mageCharacter.className,
    portraitKey: 'portrait_mage',
    splashKey: 'character_select_splash_mage',
    characterData: mageCharacter,
    order: 1,
    enabled: true,
  },
];

export default characterSelectDefinitions;
