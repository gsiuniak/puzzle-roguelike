import UIElement from './UIElement.js';

/**
 * UIImage — renders a sprite from the AssetManager by asset key.
 *
 * Properties:
 *   assetKey   - key string resolved by AssetManager
 *   assetManager - reference to AssetManager instance
 *   fitMode    - 'contain' | 'cover' | 'stretch' (default 'contain')
 *   drawWidth  - override draw width (null = use rect)
 *   drawHeight - override draw height (null = use rect)
 */
export default class UIImage extends UIElement {
  constructor(assetKey = '', assetManager = null) {
    super();
    this.assetKey = assetKey;
    this.assetManager = assetManager;
    this.fitMode = 'contain';
    this.drawWidth = null;
    this.drawHeight = null;
  }

  /** Get the loaded Image element or null */
  getImage() {
    if (!this.assetManager) return null;
    const img = this.assetManager.get(this.assetKey);
    if (!img) {
      // Try placeholder fallback
      return this.assetManager.get('placeholder');
    }
    return img;
  }

  renderSelf(ctx) {
    const img = this.getImage();
    if (!img) return;

    const r = this.rect;
    const dw = this.drawWidth || r.w;
    const dh = this.drawHeight || r.h;

    ctx.save();

    if (this.fitMode === 'stretch') {
      ctx.drawImage(img, r.x, r.y, dw, dh);
    } else if (this.fitMode === 'cover') {
      // Scale to cover, center-crop
      const scale = Math.max(dw / img.width, dh / img.height);
      const sw = Math.round(img.width * scale);
      const sh = Math.round(img.height * scale);
      const sx = r.x + (dw - sw) / 2;
      const sy = r.y + (dh - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh);
    } else {
      // 'contain' (default)
      const scale = Math.min(dw / img.width, dh / img.height, 1);
      const sw = img.width * scale;
      const sh = img.height * scale;
      const sx = r.x + (dw - sw) / 2;
      const sy = r.y + (dh - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh);
    }

    ctx.restore();
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.assetKey !== undefined) this.assetKey = props.assetKey;
    if (props.assetManager !== undefined) this.assetManager = props.assetManager;
    if (props.fitMode !== undefined) this.fitMode = props.fitMode;
    if (props.drawWidth !== undefined) this.drawWidth = props.drawWidth;
    if (props.drawHeight !== undefined) this.drawHeight = props.drawHeight;
  }
}
