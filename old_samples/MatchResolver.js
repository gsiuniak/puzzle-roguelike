/**
 * MatchResolver module.
 * Finds matches on the board, resolves cascades, and awards mana/damage.
 */

import { SKULL_DAMAGE_CONFIG } from './data/tileTypes.js';
import { isSkull } from './Tile.js';

/**
 * MatchResolver processes board matches and awards mana/damage to combatants.
 */
export class MatchResolver {
  /**
   * @param {Object} battleSystem - The BattleSystem instance for event dispatching.
   */
  constructor(battleSystem) {
    this.battleSystem = battleSystem;
    this.maxCascades = 50; // Safety limit to prevent infinite loops
    this.explosionDisplayTime = 600; // ms to show exploded/empty space before gravity
    this.cascadeDelay = 400; // ms between cascade steps
    this._extraTurnTriggered = false; // Track if toast has already been shown for this match sequence
  }

  /**
   * Helper to create a delay.
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Resolve all matches on the board for the given side.
   * Handles cascades automatically with animations.
   * @param {import('./Board.js').Board} board
   * @param {import('./Combatant.js').Combatant} combatant - The active side's combatant.
   * @param {import('./Combatant.js').Combatant} opponent - The opposing combatant.
   * @returns {Promise<{ manaGained: Array, skullDamage: number, extraTurn: boolean, cascades: number, totalTilesDestroyed: number }>}
   */
  async resolve(board, combatant, opponent) {
    let extraTurn = false;
    let totalTilesDestroyed = 0;
    let cascades = 0;
    const manaGained = [];

    for (let cascade = 0; cascade < this.maxCascades; cascade++) {
      cascades++;
      // Use findAllConnectedMatches() which already merges overlapping runs
      // and returns unique tile counts for each connected shape
      const matches = board.findAllConnectedMatches();

      if (matches.length === 0) break;

      // Process each connected match shape
      // Each match already has deduplicated positions and unique count
      const allPositions = new Set();
      const mergedMana = {};
      let cascadeSkullDamage = 0;
      let cascadeExtraTurn = false;

      for (const match of matches) {
        // Record unique positions
        for (const pos of match.positions) {
          allPositions.add(`${pos.col},${pos.row}`);
        }

        const matchCount = match.count; // Already deduplicated unique tile count

        if (isSkull(match.typeId)) {
          // Skull match: calculate damage based on unique tile count
          const damage = Math.min(matchCount, SKULL_DAMAGE_CONFIG.maxDamage) * SKULL_DAMAGE_CONFIG.baseMultiplier;
          cascadeSkullDamage += damage;
          if (matchCount >= 4) cascadeExtraTurn = true;
        } else {
          // Mana match: accumulate based on unique tile count
          mergedMana[match.typeId] = (mergedMana[match.typeId] || 0) + matchCount;
          if (matchCount >= 4) cascadeExtraTurn = true;
        }
      }

      // === IMMEDIATE RESOLUTION: Trigger skull damage BEFORE any cascade actions ===
      // Skull damage and screen shake should fire immediately when match is detected
      if (cascadeSkullDamage > 0) {
        const result = opponent.takeDamage(cascadeSkullDamage);
        this.battleSystem.emit('damageDealt', {
          source: combatant.side,
          target: opponent.side,
          amount: result.actualDamage,
          type: 'skull',
        });
        this.battleSystem.emit('damageTaken', {
          side: opponent.side,
          amount: result.actualDamage,
          blocked: result.blocked,
        });
        this.battleSystem.addLog(`Skull match deals ${result.actualDamage} damage!`);
      }

      // Award mana immediately (based on unique tile counts)
      for (const [color, count] of Object.entries(mergedMana)) {
        combatant.gainMana(color, count);
        manaGained.push({ color, amount: count });
        this.battleSystem.emit('manaGained', {
          side: combatant.side,
          color,
          amount: count,
        });
        this.battleSystem.addLog(`${combatant.name} gains ${count} ${color} mana.`);
      }

      // Emit extra turn toast immediately when a 4+ match is detected (first time only)
      if (cascadeExtraTurn && !this._extraTurnTriggered) {
        this._extraTurnTriggered = true;
        this.battleSystem.emit('extraTurn', {
          side: combatant.side,
          reason: '4+ match',
        });
      }

      // Emit match found event to trigger explosion particles
      this.battleSystem.emit('matchFound', {
        matches,
        cascade,
      });

      // Remove tiles (they explode and stay empty briefly)
      const positions = [];
      for (const key of allPositions) {
        const [col, row] = key.split(',').map(Number);
        positions.push({ col, row });
      }
      const removed = board.removeTiles(positions);
      totalTilesDestroyed += removed;

      this.battleSystem.emit('tilesDestroyed', { count: removed });
      this.battleSystem.addLog(`${removed} tiles destroyed.`);

      // Wait to show the explosion/empty space before gravity kicks in
      await this._delay(this.explosionDisplayTime);

      // Track extra turn from 4+ matches across all cascades
      if (cascadeExtraTurn) {
        extraTurn = true;
      }

      // Capture grid state before gravity for animation comparison
      const gridBeforeGravity = board.grid.map(col => [...col]);

      // Apply gravity and refill
      board.applyGravity();
      board.refill();

      // Generate fall animation data
      const fallData = board.generateFallAnimations(gridBeforeGravity);
      this.battleSystem.emit('tilesFalling', { fallData });

      // Wait for fall animation to complete
      await this._delay(this.cascadeDelay);
    }

    // Grant extra turn if any match was 4+ (across all cascades)
    if (extraTurn) {
      this.battleSystem.emit('extraTurnConfirmed', {
        side: combatant.side,
        reason: '4+ match',
      });
      this.battleSystem.addLog(`${combatant.name} gets an extra turn!`);
    }

    // Reset state for next resolve call
    this._extraTurnTriggered = false;

    this.battleSystem.emit('boardSettled', {});

    return {
      manaGained,
      skullDamage: 0,
      extraTurn,
      cascades,
      totalTilesDestroyed,
    };
  }
}
