/**
 * CombatLog — ring buffer for combat event messages.
 *
 * Pure data store. No rendering, no DOM.
 * BattleController writes events; UI reads them for display.
 */

export default class CombatLog {
  /**
   * @param {number} [maxEntries=50] - maximum log entries to keep
   */
  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
    /** @type {Array<{turn: number, message: string, timestamp: number}>} */
    this.entries = [];
    this.turnNumber = 0;
    /** Callback: (entry) => {} called when a new entry is added */
    this.onEntry = null;
  }

  /**
   * Add a log entry.
   * @param {string} message
   */
  add(message) {
    this.entries.push({
      turn: this.turnNumber,
      message,
      timestamp: Date.now(),
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    if (this.onEntry) {
      this.onEntry(this.entries[this.entries.length - 1]);
    }
  }

  /**
   * Advance the turn counter.
   */
  nextTurn() {
    this.turnNumber++;
  }

  /**
   * Get recent entries (newest last).
   * @param {number} [count=10] - how many entries to return
   * @returns {Array<{turn: number, message: string}>}
   */
  getRecent(count = 10) {
    return this.entries.slice(-count);
  }

  /** @returns {Array<{turn: number, message: string}>} */
  getAll() {
    return [...this.entries];
  }

  /** Clear all entries */
  clear() {
    this.entries = [];
    this.turnNumber = 0;
  }
}
