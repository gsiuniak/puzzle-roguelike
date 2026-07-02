import UIPanel from './UIPanel.js';

// ── Tunable layout constants ─────────────────────────────
// Inset inside the (already-square) panel art frame. Measured from the
// 2026-07 `battle_board_panel.png` (1178×1181 — border rails: left/right
// ~45px, top ~74px, bottom ~53px native), converted for the ~1064px render
// square (×0.90) plus a little breathing room. The centered gem crests at
// top/bottom deliberately overlap the inner margin (decoration over the gap).
const FRAME_INSET = { top: 70, right: 44, bottom: 52, left: 44 };

/**
 * BattleBoardPanel — decorative square wrapper around the BoardPlaceholder.
 *
 * Behavior:
 *   - The panel rect itself can be wider than tall (it fills the available
 *     center-column space), but we render the `battle_board_panel` art as
 *     a centered SQUARE inside that rect. The square's side length is
 *     `Math.min(rect.w, rect.h)`. This keeps the decorative frame from
 *     stretching horizontally.
 *   - The single child (BoardPlaceholder) is laid out into the same
 *     centered square, minus FRAME_INSET, so the 8×8 tile grid sits
 *     squarely inside the frame.
 */
export default class BattleBoardPanel extends UIPanel {
  constructor(assetManager = null) {
    super();
    this.assetManager = assetManager;
    this.smoothing = true;

    this.direction = 'column';
    this.alignItems = 'stretch';
    this.padding = 0; // explicit — we use _getFrameRect() instead
    this.backgroundAssetKey = 'battle_board_panel';
  }

  setAssetManager(am) {
    this.assetManager = am;
  }

  /** Largest centered square inside this.rect — where the frame art renders. */
  _getFrameRect() {
    const r = this.rect;
    const size = Math.min(r.w, r.h);
    return {
      x: r.x + (r.w - size) / 2,
      y: r.y + (r.h - size) / 2,
      w: size,
      h: size,
    };
  }

  /** Inner rect (frame minus decorative inset) — where the board sits. */
  _getInnerRect() {
    const f = this._getFrameRect();
    return {
      x: f.x + FRAME_INSET.left,
      y: f.y + FRAME_INSET.top,
      w: f.w - FRAME_INSET.left - FRAME_INSET.right,
      h: f.h - FRAME_INSET.top - FRAME_INSET.bottom,
    };
  }

  /** Override: draw the panel art as a centered square instead of stretching. */
  renderSelf(ctx) {
    if (this.backgroundAssetKey && this.assetManager) {
      const img = this.assetManager.get(this.backgroundAssetKey);
      if (img) {
        this._applySmoothing(ctx);
        const f = this._getFrameRect();
        ctx.drawImage(
          img,
          Math.floor(f.x), Math.floor(f.y),
          Math.ceil(f.w), Math.ceil(f.h)
        );
        this._restoreSmoothing(ctx);
      }
    }
    if (this.background) this._drawBackground(ctx);
    if (this.borderColor && this.borderWidth > 0) this._drawBorder(ctx);
  }

  /**
   * Override the container layout so the single board child is placed at
   * a centered square, regardless of how the parent column sized us.
   * The board renders its 8×8 cells inside this square cleanly.
   */
  layoutChildren() {
    const inner = this._getInnerRect();
    for (const child of this.children) {
      if (!child.visible) continue;
      child.rect.x = inner.x;
      child.rect.y = inner.y;
      child.rect.w = inner.w;
      child.rect.h = inner.h;
      child.layoutChildren();
    }
  }
}
