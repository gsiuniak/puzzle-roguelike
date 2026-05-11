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
    // Draw background image first (cover mode — scale to fill, center-crop)
    if (this.backgroundAssetKey && this.assetManager) {
      const img = this.assetManager.get(this.backgroundAssetKey);
      if (img) {
        ctx.save();
        const r = this.rect;
        if (this.cornerRadius > 0) {
          this._roundRect(ctx, r.x, r.y, r.w, r.h, this.cornerRadius);
          ctx.clip();
        }
        // Cover: scale proportionally to fill, center-crop
        const scale = Math.max(r.w / img.width, r.h / img.height);
        const sw = img.width * scale;
        const sh = img.height * scale;
        const sx = r.x + (r.w - sw) / 2;
        const sy = r.y + (r.h - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh);
        ctx.restore();
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
