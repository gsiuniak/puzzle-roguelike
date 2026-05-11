import UIElement from './UIElement.js';

/**
 * UIOrb — circular mana/stat orb with color, count text, optional image.
 *
 * Properties:
 *   color      - fallback fill color (CSS string)
 *   count      - number displayed centered inside
 *   countColor - CSS color for count text (default 'white')
 *   fontSize   - number
 *   assetKey   - optional image overlay from AssetManager
 *   assetManager - AssetManager reference
 *   borderColor- CSS border color
 *   borderWidth- number (default 1)
 *   showCount  - boolean, whether to render the count number (default true)
 */
export default class UIOrb extends UIElement {
  constructor() {
    super();
    this.color = '#ff4444';
    this.count = 0;
    this.countColor = '#ffffff';
    this.fontSize = 16;
    this.assetKey = null;
    this.assetManager = null;
    this.borderColor = '#886622';
    this.borderWidth = 2;
    this.showCount = true;
  }

  renderSelf(ctx) {
    const r = this.rect;
    // Use smaller dimension for circle
    const size = Math.min(r.w, r.h);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const radius = size / 2 - this.borderWidth;

    ctx.save();

    // Draw circle fill
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();

    // Draw image overlay if available
    if (this.assetKey && this.assetManager) {
      const img = this.assetManager.get(this.assetKey);
      if (img) {
        // Clip to circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        const scale = Math.min(
          (radius * 2) / img.width,
          (radius * 2) / img.height
        );
        const sw = img.width * scale;
        const sh = img.height * scale;
        ctx.drawImage(img, cx - sw / 2, cy - sh / 2, sw, sh);
        ctx.restore();
      }
    }

    // Border
    if (this.borderWidth > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = this.borderColor;
      ctx.lineWidth = this.borderWidth;
      ctx.stroke();
    }

    // Count text centered
    if (this.showCount) {
      ctx.fillStyle = this.countColor;
      const fs = Math.max(10, Math.min(this.fontSize, radius));
      ctx.font = `bold ${fs}px Georgia, "Times New Roman", serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(String(this.count), cx, cy);
    }

    ctx.restore();
  }

  setStyle(props) {
    super.setStyle(props);
    if (props.color !== undefined) this.color = props.color;
    if (props.count !== undefined) this.count = props.count;
    if (props.countColor !== undefined) this.countColor = props.countColor;
    if (props.fontSize !== undefined) this.fontSize = props.fontSize;
    if (props.assetKey !== undefined) this.assetKey = props.assetKey;
    if (props.assetManager !== undefined) this.assetManager = props.assetManager;
    if (props.borderColor !== undefined) this.borderColor = props.borderColor;
    if (props.borderWidth !== undefined) this.borderWidth = props.borderWidth;
    if (props.showCount !== undefined) this.showCount = props.showCount;
  }
}
