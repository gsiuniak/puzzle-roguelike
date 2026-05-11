/**
 * UI module.
 * Manages UI state: combat log, hovered skill, game over state.
 */

export class UI {
  constructor() {
    this.logEntries = [];
    this.hoveredSkill = null;
    this.gameOver = false;
    this.winner = null;
    this.maxLogEntries = 30;
  }

  /**
   * Add a combat log entry.
   * @param {string} message
   */
  addLogEntry(message) {
    this.logEntries.push(message);
    if (this.logEntries.length > this.maxLogEntries) {
      this.logEntries.shift();
    }
  }

  /**
   * Get all log entries.
   * @returns {string[]}
   */
  getLogEntries() {
    return [...this.logEntries];
  }

  /**
   * Set the currently hovered skill.
   * @param {Object|null} skill
   */
  setHoveredSkill(skill) {
    this.hoveredSkill = skill;
  }

  /**
   * Get the currently hovered skill.
   * @returns {Object|null}
   */
  getHoveredSkill() {
    return this.hoveredSkill;
  }

  /**
   * Set game over state.
   * @param {string} winner - 'player' or 'enemy'.
   */
  setGameOver(winner) {
    this.gameOver = true;
    this.winner = winner;
  }

  /**
   * Check if the game is over.
   * @returns {boolean}
   */
  isGameOver() {
    return this.gameOver;
  }

  /**
   * Get the winner.
   * @returns {string|null}
   */
  getWinner() {
    return this.winner;
  }

  /**
   * Reset UI state.
   */
  reset() {
    this.logEntries = [];
    this.hoveredSkill = null;
    this.gameOver = false;
    this.winner = null;
  }
}
