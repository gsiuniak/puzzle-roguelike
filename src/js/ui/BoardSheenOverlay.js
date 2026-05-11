/**
 * BoardSheenOverlay — subtle idle shimmer effect rendered over the board.
 *
 * A soft, diagonal translucent band sweeps repeatedly across the board
 * while the game is in PLAYER_TURN (idle). The effect pauses during
 * swaps, match resolution, cascades, enemy turn, and game-over.
 *
 * The sheen uses additive blending (lighter) to gently brighten the
 * tiles underneath the band, creating a polished "living board" feel
 * without being distracting.
 *
 * Usage:
 *   const sheen = new BoardSheenOverlay(boardPlaceholder, battleController);
 *   // each frame:
 *   sheen.update(dt);
 *   sheen.render(ctx);  // call AFTER board tiles are drawn
 */

import { BattleState } from '../game/BattleController.js';

export default class BoardSheenOverlay {
  /**
   * @param {import('./BoardPlaceholder.js').default} boardPlaceholder
   * @param {import('../game/BattleController.js').default} battleController
   */
  constructor(boardPlaceholder, battleController) {
    this._board = boardPlaceholder;
    this._controller = battleController;
    this._phase = 0;

    /** Seconds per full sweep */
    this.sweepDuration = 4.2;

    /** Diagonal angle in radians (negative = top-left to bottom-right) */
    this.angle = -28 * Math.PI / 180;

    /** Width of the sheen band as fraction of board diagonal */
    this.bandWidthRatio = 0.38;

    /** Peak opacity at band centre */
    this.peakAlpha = 0.13;

    /** Warm tint factor (0 = pure white, 1 = warm gold) */
    this.warmth = 0.35;
  }

  // ── Update ────────────────────────────────────────────

  /**
   * Advance the sheen phase. Only progresses during PLAYER_TURN.
   * @param {number} dt - delta time in milliseconds
   */
  update(dt) {
    if (!this._controller) return;

    // Only animate during idle player turn
    if (this._controller.state !== BattleState.PLAYER_TURN) return;

    this._phase += (dt / 1000) / this.sweepDuration;
    while (this._phase >= 1) this._phase -= 1;
  }

  // ── Render ────────────────────────────────────────────

  /**
   * Draw the sheen overlay. Must be called AFTER board tiles are
   * rendered and BEFORE floating text/fx.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this._board) return;
    const { cellSize, offsetX, offsetY } = this._board.getCellMetrics();
    const cols = this._board.cols;
    const rows = this._board.rows;
    if (cols <= 0 || rows <= 0 || cellSize <= 0) return;

    // Tile grid area (excludes any padding/centering in the board rect)
    const gridW = cols * cellSize;
    const gridH = rows * cellSize;

    const diagonal = Math.sqrt(gridW * gridW + gridH * gridH);
    const bandW = diagonal * this.bandWidthRatio;
    const travel = diagonal + bandW; // total distance the band travels

    // Centre of tile grid
    const cx = offsetX + gridW / 2;
    const cy = offsetY + gridH / 2;

    // Band centre position along sweep axis
    const bandCx = -travel / 2 + this._phase * travel;

    ctx.save();

    // Clip strictly to the tile grid (no padding around cells)
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, gridW, gridH);
    ctx.clip();

    // Translate to board centre, rotate to diagonal sweep angle
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);

    // Compute warm-tinted colour stops
    const rCol = Math.round(255);
    const gCol = Math.round(255 - 25 * this.warmth);
    const bCol = Math.round(255 - 80 * this.warmth);

    // Build gradient perpendicular to sweep direction
    const gx1 = bandCx - bandW / 2;
    const gx2 = bandCx + bandW / 2;
    const gradient = ctx.createLinearGradient(gx1, 0, gx2, 0);

    const alphaPeak = this.peakAlpha;
    const alphaEdge = alphaPeak * 0.35;
    const alphaFade = 0;

    gradient.addColorStop(0.0, `rgba(${rCol},${gCol},${bCol},${alphaFade})`);
    gradient.addColorStop(0.2, `rgba(${rCol},${gCol},${bCol},${alphaEdge})`);
    gradient.addColorStop(0.5, `rgba(${rCol},${gCol},${bCol},${alphaPeak})`);
    gradient.addColorStop(0.8, `rgba(${rCol},${gCol},${bCol},${alphaEdge})`);
    gradient.addColorStop(1.0, `rgba(${rCol},${gCol},${bCol},${alphaFade})`);

    // Use additive blending so tiles underneath appear slightly brighter
    ctx.globalCompositeOperation = 'lighter';

    ctx.fillStyle = gradient;
    // Draw a tall strip so it covers the board even when rotated
    ctx.fillRect(gx1, -diagonal * 1.5, bandW, diagonal * 3);

    ctx.restore();
  }

  // ── Setters ───────────────────────────────────────────

  /** Update board reference (e.g. after board is recreated). */
  setBoard(boardPlaceholder) {
    this._board = boardPlaceholder;
  }

  /** Update controller reference. */
  setController(battleController) {
    this._controller = battleController;
  }

  /** Reset the sweep phase to start. */
  reset() {
    this._phase = 0;
  }
}
