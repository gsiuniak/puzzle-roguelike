import UIContainer from './UIContainer.js';

/**
 * UIPanel — a container with a background image from AssetManager.
 *
 * Properties:
 *   backgroundAssetKey - AssetManager key for background image
 *   assetManager       - AssetManager reference
 *   (inherits all UIContainer properties: background color, border, cornerRadius, etc.)
 */
export default class UIPanel extends UIContainer {
  constructor() {
    super();
    this.backgroundAssetKey = null;
    this.assetManager = null;
  }

  renderSelf(ctx) {
    // Draw background image first (stretch mode — fill entire area, every part visible)
    if (this.backgroundAssetKey && this.assetManager) {
      const img = this.assetManager.get(this.backgroundAssetKey);
      if (img) {
        this._applySmoothing(ctx);
        ctx.save();
        const r = this.rect;
        const rx = Math.floor(r.x);
        const ry = Math.floor(r.y);
        const rw = Math.ceil(r.w);
        const rh = Math.ceil(r.h);
        if (this.cornerRadius > 0) {
          this._roundRect(ctx, rx, ry, rw, rh, this.cornerRadius);
          ctx.clip();
        }
        // Stretch: draw image to exactly fill the panel rect
        this._drawArtScaled(ctx, this.backgroundAssetKey, img, rx, ry, rw, rh);
        ctx.restore();
        this._restoreSmoothing(ctx);
      }
    }

    // Then draw color background (as overlay tint, optional)
    if (this.background) {
      this._drawBackground(ctx);
    }

    // Border
    if (this.borderColor && this.borderWidth > 0) {
      this._drawBorder(ctx);
    }
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.backgroundAssetKey !== undefined) this.backgroundAssetKey = props.backgroundAssetKey;
    if (props.assetManager !== undefined) this.assetManager = props.assetManager;
  }

  /**
   * Draw panel art via a PHYSICAL-resolution pre-scaled bake
   * (AssetManager.getScaled with high-quality smoothing) so the per-frame
   * draw is a ~1:1 blit instead of a full-res smoothed resample of large
   * source art (the character/skills/board panel arts are 850–1200px sources
   * drawn every frame). The bake is only used once the target size has been
   * stable for a frame — a panel whose rect animates falls back to the direct
   * draw, so it can never thrash the scaled cache with per-frame bakes.
   * Physical scale comes from the live ctx transform (decision #51 — never
   * window.devicePixelRatio).
   */
  _drawArtScaled(ctx, key, img, x, y, w, h) {
    let baked = null;
    if (typeof ctx.getTransform === 'function') {
      const m = ctx.getTransform();
      const pxScale = Math.max(0.1, Math.hypot(m.a, m.b));
      const bw = Math.max(1, Math.round(w * pxScale));
      const bh = Math.max(1, Math.round(h * pxScale));
      if (bw === this._artBakeW && bh === this._artBakeH) {
        baked = this.assetManager.getScaled(key, bw, bh, true);
      }
      this._artBakeW = bw;
      this._artBakeH = bh;
    }
    ctx.drawImage(baked || img, x, y, w, h);
  }
}
