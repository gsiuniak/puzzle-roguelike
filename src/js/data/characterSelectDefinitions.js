/**
 * characterSelectDefinitions.js — static mapping of selectable characters
 * for the CharacterSelectScene.
 *
 * Each entry references gameplay data from data/characters/ and adds
 * display-only metadata (splash art key, portrait key, order, enabled state).
 *
 * Adding a new character means:
 *   1. Add the gameplay definition in data/characters/ (per-file + index.js entry)
 *   2. Add a corresponding entry in the array below with the correct asset keys
 *   3. Register the new splash/portrait assets in main.js ASSET_MAP
 *
 * The scene renders from this array — no hardcoded Warrior/Mage logic.
 */

import { warrior, mage, witchDoctor } from './characters/index.js';

const characterSelectDefinitions = [
  {
    id: 'warrior',
    name: warrior.name,
    className: warrior.className,
    /** Asset key for the portrait icon shown in the heroes row */
    portraitKey: 'character_select_portrait_warrior',
    /** Asset key for the full-screen splash background */
    splashKey: 'character_select_splash_warrior',
    /**
     * Optional full-screen "choose hero" intro video (URL relative to
     * index.html). Plays full-canvas (same framing as the splash) when this
     * hero is confirmed; the UI fades out and the scene cross-fades to the
     * next scene as the video nears its end. Omit to confirm instantly.
     * NOT an AssetManager entry — played via an off-DOM <video>.
     */
    splashVideo: 'assets/sprites/character_select/character_select_splash_video_warrior.mp4',
    /** Aura color {r,g,b} in 0-1 range — red/orange ember */
    auraColor: { r: 1.0, g: 0.28, b: 0.08 },
    /** Reference to the gameplay character data (hp, mana, skills, etc.) */
    characterData: warrior,
    /** Display order in the heroes row (lower = leftmost) */
    order: 0,
    /** Whether this character is selectable */
    enabled: true,
  },
  {
    id: 'mage',
    name: mage.name,
    className: mage.className,
    portraitKey: 'character_select_portrait_mage',
    splashKey: 'character_select_splash_mage',
    /** Optional full-screen "choose hero" intro video (see warrior above). */
    splashVideo: 'assets/sprites/character_select/character_select_splash_video_mage.mp4',
    /** Aura color {r,g,b} in 0-1 range — purple/violet arcane */
    auraColor: { r: 0.55, g: 0.15, b: 0.85 },
    characterData: mage,
    order: 1,
    enabled: true,
  },
  {
    id: 'witch_doctor',
    name: witchDoctor.name,
    className: witchDoctor.className,
    portraitKey: 'character_select_portrait_witch_doctor',
    splashKey: 'character_select_splash_witch_doctor',
    /** Optional full-screen "choose hero" intro video (see warrior above). */
    splashVideo: 'assets/sprites/character_select/character_select_splash_video_witch_doctor.mp4',
    /** Aura color {r,g,b} in 0-1 range — greyish to complement splash art */
    auraColor: { r: 0.35, g: 0.35, b: 0.35 },
    characterData: witchDoctor,
    order: 2,
    enabled: true,
  },
];

export default characterSelectDefinitions;
