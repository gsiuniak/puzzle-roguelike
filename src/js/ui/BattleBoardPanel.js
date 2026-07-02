import UIPanel from './UIPanel.js';

// ── Tunable layout constants ─────────────────────────────
// The border-only overlay art (`battle_board_panel_overlay.png`) — same
// 1178×1181 canvas as the base panel, transparent middle — drawn at the SAME
// frame rect AFTER the board child, so the frame rails sit ON TOP of the
// tiles and crop their edges cleanly.
const FRAME_OVERLAY_KEY = 'battle_board_panel_overlay';

// TRUE inner-edge insets of the frame rails, alpha-scanned from the overlay
// art (rail inner edges at native L73 / T75 / R79 / B74 of 1178×1181) and
// converted for the 1080px render square (×0.917).
const FRAME_INSET_TRUE = { top: 69, right: 72, bottom: 68, left: 67 };
// How far the tiles extend UNDER the frame rails on each side (px). The
// overlay border crops them, so gem edges tuck beneath the frame — THE knob
// for the tuck depth. 0 = tiles flush with the rails' inner edge.
const FRAME_TILE_TUCK = 6;
// Effective board inset = true rail inset minus the tuck.
const FRAME_INSET = {
  top:    FRAME_INSET_TRUE.top    - FRAME_TILE_TUCK,
  right:  FRAME_INSET_TRUE.right  - FRAME_TILE_TUCK,
  bottom: FRAME_INSET_TRUE.bottom - FRAME_TILE_TUCK,
  left:   FRAME_INSET_TRUE.left   - FRAME_TILE_TUCK,
};

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
 *     squarely inside the frame — deliberately FRAME_TILE_TUCK px UNDER the
 *     frame rails on each side.
 *   - After the board child renders, the border-only overlay art is drawn at
 *     the same square (render() override), so the rails + gem crests sit ON
 *     TOP of the tile edges and crop them cleanly.
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

  /** After the board child renders, draw the border-only frame ON TOP so the
   *  rails crop the tucked tile edges (see FRAME_TILE_TUCK). The match-4+
   *  flourish's grown/emerging tiles then draw ABOVE the frame (the board
   *  darken stays beneath it — see BoardPlaceholder.renderFlourishOverlay). */
  render(ctx) {
    super.render(ctx);
    if (!this.visible) return;
    this._renderFrameOverlay(ctx);
    for (const child of this.children) {
      if (child.visible && typeof child.renderFlourishOverlay === 'function') {
        child.renderFlourishOverlay(ctx);
      }
    }
  }

  _renderFrameOverlay(ctx) {
    if (!this.assetManager) return;
    const img = this.assetManager.get(FRAME_OVERLAY_KEY);
    if (!img || img.complete === false || !img.width) return;
    const f = this._getFrameRect();
    this._applySmoothing(ctx);
    ctx.drawImage(
      img,
      Math.floor(f.x), Math.floor(f.y),
      Math.ceil(f.w), Math.ceil(f.h)
    );
    this._restoreSmoothing(ctx);
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
