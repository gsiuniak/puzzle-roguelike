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
        ctx.drawImage(img, rx, ry, rw, rh);
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
}
