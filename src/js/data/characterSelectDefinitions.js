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

import { warriorCharacter, mageCharacter, witchDoctorCharacter } from './mockCharacter.js';

const characterSelectDefinitions = [
  {
    id: 'warrior',
    name: warriorCharacter.name,
    className: warriorCharacter.className,
    /** Asset key for the portrait icon shown in the heroes row */
    portraitKey: 'character_select_portrait_warrior',
    /** Asset key for the full-screen splash background */
    splashKey: 'character_select_splash_warrior',
    /** Aura color {r,g,b} in 0-1 range — red/orange ember */
    auraColor: { r: 1.0, g: 0.28, b: 0.08 },
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
    portraitKey: 'character_select_portrait_mage',
    splashKey: 'character_select_splash_mage',
    /** Aura color {r,g,b} in 0-1 range — purple/violet arcane */
    auraColor: { r: 0.55, g: 0.15, b: 0.85 },
    characterData: mageCharacter,
    order: 1,
    enabled: true,
  },
  {
    id: 'witch_doctor',
    name: witchDoctorCharacter.name,
    className: witchDoctorCharacter.className,
    portraitKey: 'character_select_portrait_witch_doctor',
    splashKey: 'character_select_splash_witch_doctor',
    /** Aura color {r,g,b} in 0-1 range — greyish to complement splash art */
    auraColor: { r: 0.35, g: 0.35, b: 0.35 },
    characterData: witchDoctorCharacter,
    order: 2,
    enabled: true,
  },
];

export default characterSelectDefinitions;
