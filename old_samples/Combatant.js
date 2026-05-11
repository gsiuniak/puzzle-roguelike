/**
 * Combatant module.
 * Represents a player or enemy character with HP, mana pools, block, stats, and skills.
 */

import { getSkillEffect } from './data/skills.js';

/**
 * Combatant class - represents a battle participant.
 */
export class Combatant {
  /**
   * @param {Object} config
   * @param {string} config.id - Unique identifier.
   * @param {string} config.name - Display name.
   * @param {string} config.subtitle - Optional subtitle (class/title).
   * @param {string} config.side - 'player' or 'enemy'.
   * @param {number} config.hp - Starting HP.
   * @param {number} config.maxHp - Maximum HP.
   * @param {number} config.attack - Attack stat.
   * @param {number} config.armor - Armor stat.
   * @param {string} config.portraitUrl - URL for portrait sprite.
   * @param {string} config.attackIconUrl - URL for attack icon.
   * @param {string} config.armorIconUrl - URL for armor icon.
   * @param {Object.<string, number>} config.manaPools - Starting mana per color.
   * @param {Array<Object>} config.skills - Skill definitions with multi-mana support.
   */
  constructor({
    id,
    name,
    subtitle = '',
    side,
    hp,
    maxHp,
    attack = 0,
    armor = 0,
    portraitUrl = '',
    attackIconUrl = '',
    armorIconUrl = '',
    manaPools = {},
    skills = [],
  }) {
    this.id = id;
    this.name = name;
    this.subtitle = subtitle;
    this.side = side;
    this.maxHp = maxHp;
    this.hp = hp;
    this.attack = attack;
    this.armor = armor;
    this.portraitUrl = portraitUrl;
    this.attackIconUrl = attackIconUrl;
    this.armorIconUrl = armorIconUrl;
    this.manaPools = { ...manaPools };
    this.skills = skills.map(s => ({
      ...s,
      effectId: s.id,
    }));
    this.block = 0;

    // Status effects tracking (reserved for future expansion)
    this.statusEffects = [];
    this.buffs = [];
  }

  /**
   * Get current HP.
   * @returns {number}
   */
  getHp() {
    return this.hp;
  }

  /**
   * Get maximum HP.
   * @returns {number}
   */
  getMaxHp() {
    return this.maxHp;
  }

  /**
   * Get current attack value (including buffs).
   * @returns {number}
   */
  getAttack() {
    let bonus = 0;
    for (const buff of this.buffs) {
      if (buff.type === 'attack' && buff.remaining > 0) {
        bonus += buff.value;
      }
    }
    return this.attack + bonus;
  }

  /**
   * Get current armor value (including buffs).
   * @returns {number}
   */
  getArmor() {
    let bonus = 0;
    for (const buff of this.buffs) {
      if (buff.type === 'armor' && buff.remaining > 0) {
        bonus += buff.value;
      }
    }
    return this.armor + bonus;
  }

  /**
   * Get mana of a specific color.
   * @param {string} color
   * @returns {number}
   */
  getMana(color) {
    return this.manaPools[color] || 0;
  }

  /**
   * Get all mana pools.
   * @returns {Object.<string, number>}
   */
  getManaPools() {
    return { ...this.manaPools };
  }

  /**
   * Get current block value.
   * @returns {number}
   */
  getBlock() {
    return this.block;
  }

  /**
   * Get skills.
   * @returns {Array}
   */
  getSkills() {
    return [...this.skills];
  }

  /**
   * Apply block.
   * @param {number} amount
   */
  applyBlock(amount) {
    this.block += amount;
  }

  /**
   * Take damage, respecting armor and block.
   * Armor acts as a shield and is depleted before HP is reduced.
   * Block is consumed after armor, then HP.
   * @param {number} amount - Incoming damage.
   * @returns {{ actualDamage: number, blocked: number, armorDamage: number }}
   */
  takeDamage(amount) {
    let remaining = amount;
    let blocked = 0;
    let armorDamage = 0;

    // Armor absorbs damage first (acts as extra health)
    if (this.armor > 0) {
      armorDamage = Math.min(this.armor, remaining);
      this.armor -= armorDamage;
      remaining -= armorDamage;
    }

    // Block absorbs remaining damage
    if (this.block > 0) {
      blocked = Math.min(this.block, remaining);
      this.block -= blocked;
      remaining -= blocked;
    }

    this.hp = Math.max(0, this.hp - remaining);

    return { actualDamage: amount - blocked, blocked, armorDamage };
  }

  /**
   * Spend mana for a skill with multi-mana support.
   * @param {Array<{color: string, amount: number}>} manaCosts - Array of mana costs.
   * @returns {boolean} True if all mana was spent.
   */
  spendManaForSkill(manaCosts) {
    for (const cost of manaCosts) {
      if ((this.manaPools[cost.color] || 0) < cost.amount) {
        return false;
      }
    }
    for (const cost of manaCosts) {
      this.manaPools[cost.color] -= cost.amount;
    }
    return true;
  }

  /**
   * Check if combatant can afford a skill.
   * Supports both new multi-mana format (manaCosts array) and legacy single-cost format.
   * @param {Object} skill - Skill definition.
   * @returns {boolean}
   */
  canAffordSkill(skill) {
    // New format: manaCosts array
    if (skill.manaCosts && Array.isArray(skill.manaCosts) && skill.manaCosts.length > 0) {
      for (const cost of skill.manaCosts) {
        if ((this.manaPools[cost.color] || 0) < cost.amount) {
          return false;
        }
      }
      return true;
    }
    // Legacy format: single costColor/costAmount
    if (skill.costColor && skill.costAmount !== undefined) {
      return (this.manaPools[skill.costColor] || 0) >= skill.costAmount;
    }
    // No cost required
    return true;
  }

  /**
   * Gain mana of a specific color.
   * @param {string} color
   * @param {number} amount
   */
  gainMana(color, amount) {
    this.manaPools[color] = (this.manaPools[color] || 0) + amount;
  }

  /**
   * Add a status effect.
   * @param {Object} effect - { type, name, duration, value }
   */
  addStatusEffect(effect) {
    this.statusEffects.push({ ...effect, remaining: effect.duration });
  }

  /**
   * Process status effects (decrement durations).
   */
  processStatusEffects() {
    this.statusEffects = this.statusEffects.filter(e => {
      e.remaining--;
      return e.remaining > 0;
    });
    this.buffs = this.buffs.filter(b => {
      b.remaining--;
      return b.remaining > 0;
    });
  }

  /**
   * Check if the combatant is alive.
   * @returns {boolean}
   */
  isAlive() {
    return this.hp > 0;
  }

  /**
   * Reset combatant to full health (for game over / restart).
   */
  reset() {
    this.hp = this.maxHp;
    this.block = 0;
    for (const color of Object.keys(this.manaPools)) {
      this.manaPools[color] = 0;
    }
    this.statusEffects = [];
    this.buffs = [];
  }
}
