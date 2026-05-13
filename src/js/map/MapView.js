/**
 * MapView — reusable map rendering component.
 *
 * Extracts all visual rendering from MapScene so the exact same map screen
 * can be used in two modes:
 *
 *   'fullscreen' — standalone MapScene (full-canvas splash + dark overlay outside)
 *   'overlay'    — BattleScene overlay (dark backdrop + splash inside container)
 *
 * Both modes share identical:
 *   - Container layout (16:9, centered, rounded rect)
 *   - Node/path rendering (via MapRenderer)
 *   - Depth/floor labels
 *   - Node info text
 *   - Container border + inner shadow
 *
 * @dependency MapRenderer, MapGraph, AssetManager
 */

// ── Container layout constants (identical to MapScene) ──
/** Fraction of canvas width the container occupies */
const CONTAINER_WIDTH_FRAC = 0.85;
/** Fraction of canvas height the container occupies */
const CONTAINER_HEIGHT_FRAC = 0.82;
/** Minimum horizontal padding from edges */
const CONTAINER_MIN_H_PAD = 40;
/** Minimum vertical padding from edges */
const CONTAINER_MIN_V_PAD = 24;
/** Container corner radius */
const CONTAINER_RADIUS = 16;
/** Container border width */
const CONTAINER_BORDER = 2;
/** Overlay alpha for fullscreen dark area outside container */
const OVERLAY_ALPHA = 0.55;
/** Backdrop alpha for overlay mode */
const BACKDROP_ALPHA = 0.75;

export default class MapView {
  /**
   * @param {object} deps
   * @param {import('./MapGraph.js').default} deps.graph
   * @param {import('./MapTraversalController.js').default} deps.traversal
   * @param {import('./MapRenderer.js').default} deps.renderer
   * @param {import('../engine/AssetManager.js').default} deps.assetManager
   */
  constructor({ graph, traversal, renderer, assetManager } = {}) {
    /** @type {import('./MapGraph.js').default|null} */
    this._graph = graph || null;
    /** @type {import('./MapTraversalController.js').default|null} */
    this._traversal = traversal || null;
    /** @type {import('./MapRenderer.js').default|null} */
    this._renderer = renderer || null;
    /** @type {import('../engine/AssetManager.js').default|null} */
    this._assetManager = assetManager || null;

    /** @type {{x:number,y:number,w:number,h:number}} cached container rect */
    this._containerRect = { x: 0, y: 0, w: 0, h: 0 };
  }

  // ═══════════════════════════════════════════════════════
  // Dependencies (can be updated after construction)
  // ═══════════════════════════════════════════════════════

  setGraph(graph) { this._graph = graph; if (this._renderer) this._renderer.setGraph(graph); }
  setTraversal(traversal) { this._traversal = traversal; if (this._renderer) this._renderer.setTraversal(traversal); }
  setRenderer(renderer) { this._renderer = renderer; }
  setAssetManager(am) { this._assetManager = am; }

  // ═══════════════════════════════════════════════════════
  // Container layout (identical to MapScene)
  // ═══════════════════════════════════════════════════════

  /** Target aspect ratio (16:9) */
  static CONTAINER_ASPECT = 16 / 9;

  /**
   * Compute the centered map container rect from the current canvas size.
   * Enforces a 16:9 aspect ratio, fitting within the canvas bounds.
   * @param {number} canvasW
   * @param {number} canvasH
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  getContainerRect(canvasW, canvasH) {
    // Max available area respecting padding constraints
    const maxW = Math.min(canvasW * CONTAINER_WIDTH_FRAC, canvasW - CONTAINER_MIN_H_PAD * 2);
    const maxH = Math.min(canvasH * CONTAINER_HEIGHT_FRAC, canvasH - CONTAINER_MIN_V_PAD * 2);
    const targetRatio = MapView.CONTAINER_ASPECT;

    let cw, ch;
    if (maxW / maxH > targetRatio) {
      ch = maxH;
      cw = ch * targetRatio;
    } else {
      cw = maxW;
      ch = cw / targetRatio;
    }

    const cx = Math.floor((canvasW - cw) / 2);
    const cy = Math.floor((canvasH - ch) / 2);

    this._containerRect = { x: cx, y: cy, w: cw, h: ch };
    return this._containerRect;
  }

  // ═══════════════════════════════════════════════════════
  // Public render entry points
  // ═══════════════════════════════════════════════════════

  /**
   * Render the map in fullscreen mode (same as standalone MapScene).
   * Full-canvas splash background, dark overlay outside container,
   * container with map content inside.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} dt - delta time in ms
   */
  renderFullscreen(ctx, canvasW, canvasH, dt) {
    const cr = this.getContainerRect(canvasW, canvasH);

    // 1. Full-canvas splash background
    this._drawFullCanvasBackground(ctx, canvasW, canvasH);

    // 2. Dark overlay outside the container
    this._drawOverlayOutsideContainer(ctx, canvasW, canvasH, cr);

    // 3. Subtle inner shadow at container edges
    ctx.save();
    this._drawContainerInnerShadow(ctx, cr);
    ctx.restore();

    // 4. Clip & translate to container interior
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.clip();
    ctx.translate(cr.x, cr.y);

    // 5. MapRenderer — nodes + paths
    if (this._renderer) {
      this._renderer.render(ctx, cr.w, cr.h, dt);
    }

    // 6. Depth labels
    this._drawDepthLabels(ctx, cr.w, cr.h);

    // 7. Node info at bottom
    this._drawNodeInfo(ctx, cr.w, cr.h);

    ctx.restore();

    // 8. Container border (on top, after clip restore)
    ctx.save();
    this._drawContainerBorder(ctx, cr);
    ctx.restore();
  }

  /**
   * Render the map in overlay mode (for BattleScene).
   * Dark semi-transparent backdrop over the battle, then the map
   * container with parchment splash background inside, framed identically
   * to the standalone map.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} dt - delta time in ms
   */
  renderOverlay(ctx, canvasW, canvasH, dt) {
    const cr = this.getContainerRect(canvasW, canvasH);

    // 1. Dark semi-transparent backdrop over entire canvas
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${BACKDROP_ALPHA})`;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.restore();

    // 2. Parchment splash background inside the container
    this._drawSplashInsideContainer(ctx, cr);

    // 3. Subtle inner shadow at container edges
    ctx.save();
    this._drawContainerInnerShadow(ctx, cr);
    ctx.restore();

    // 4. Clip & translate to container interior
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.clip();
    ctx.translate(cr.x, cr.y);

    // 5. MapRenderer — nodes + paths
    if (this._renderer) {
      this._renderer.render(ctx, cr.w, cr.h, dt);
    }

    // 6. Depth labels
    this._drawDepthLabels(ctx, cr.w, cr.h);

    // 7. Node info at bottom
    this._drawNodeInfo(ctx, cr.w, cr.h);

    ctx.restore();

    // 8. Container border (on top, after clip restore)
    ctx.save();
    this._drawContainerBorder(ctx, cr);
    ctx.restore();

    // 9. "Press M or Esc to close" hint at top
    this._drawCloseHint(ctx, canvasW);
  }

  // ═══════════════════════════════════════════════════════
  // Hit testing (delegates to MapRenderer)
  // ═══════════════════════════════════════════════════════

  /**
   * Hit-test a point against map nodes.
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} mx
   * @param {number} my
   * @returns {import('./MapNode.js').default|null}
   */
  hitTest(canvasW, canvasH, mx, my) {
    if (!this._renderer) return null;
    const cr = this._containerRect;
    const lx = mx - cr.x;
    const ly = my - cr.y;
    if (lx < 0 || ly < 0 || lx > cr.w || ly > cr.h) return null;
    return this._renderer.hitTest(cr.w, cr.h, lx, ly);
  }

  /**
   * Update hover state.
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} mx
   * @param {number} my
   * @returns {boolean}
   */
  updateHover(canvasW, canvasH, mx, my) {
    if (!this._renderer) return false;
    const cr = this._containerRect;
    const lx = mx - cr.x;
    const ly = my - cr.y;
    if (lx < 0 || ly < 0 || lx > cr.w || ly > cr.h) {
      return this._renderer.updateHover(cr.w, cr.h, -999, -999);
    }
    return this._renderer.updateHover(cr.w, cr.h, lx, ly);
  }

  /**
   * Layout nodes (delegates to MapRenderer).
   * @param {number} canvasW
   * @param {number} canvasH
   * @returns {{node:import('./MapNode.js').default, x:number, y:number}[]}
   */
  layoutNodes(canvasW, canvasH) {
    if (!this._renderer) return [];
    const cr = this._containerRect;
    return this._renderer.layoutNodes(cr.w, cr.h);
  }

  // ═══════════════════════════════════════════════════════
  // Private: splash / background
  // ═══════════════════════════════════════════════════════

  /**
   * Draw the map_splash image as a full-canvas background,
   * scaled to cover the entire canvas. Used in fullscreen mode.
   */
  _drawFullCanvasBackground(ctx, canvasW, canvasH) {
    const splashImg = this._assetManager ? this._assetManager.get('map_splash') : null;

    if (splashImg && splashImg.complete) {
      const imgW = splashImg.width;
      const imgH = splashImg.height;
      const scale = Math.max(canvasW / imgW, canvasH / imgH);
      const sw = imgW * scale;
      const sh = imgH * scale;
      const sx = (canvasW - sw) / 2;
      const sy = (canvasH - sh) / 2;

      ctx.save();
      ctx.drawImage(splashImg, sx, sy, sw, sh);
      ctx.restore();
    } else {
      // Fallback: dark background
      ctx.save();
      ctx.fillStyle = 'rgba(14, 10, 4, 1)';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }
  }

  /**
   * Draw the map_splash image scaled to cover the container interior.
   * Used in overlay mode as the container's parchment background.
   */
  _drawSplashInsideContainer(ctx, cr) {
    const splashImg = this._assetManager ? this._assetManager.get('map_splash') : null;

    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.clip();

    if (splashImg && splashImg.complete) {
      const imgW = splashImg.width;
      const imgH = splashImg.height;
      const scale = Math.max(cr.w / imgW, cr.h / imgH);
      const sw = imgW * scale;
      const sh = imgH * scale;
      const sx = cr.x + (cr.w - sw) / 2;
      const sy = cr.y + (cr.h - sh) / 2;

      ctx.drawImage(splashImg, sx, sy, sw, sh);
    } else {
      // Fallback: dark fill
      ctx.fillStyle = 'rgba(14, 10, 4, 1)';
      ctx.fillRect(cr.x, cr.y, cr.w, cr.h);
    }

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════
  // Private: overlay / vignette
  // ═══════════════════════════════════════════════════════

  /**
   * Draw the dark overlay in 4 rects around the container.
   * Used in fullscreen mode.
   */
  _drawOverlayOutsideContainer(ctx, canvasW, canvasH, cr) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${OVERLAY_ALPHA})`;

    // Top strip
    ctx.fillRect(0, 0, canvasW, cr.y);
    // Bottom strip
    ctx.fillRect(0, cr.y + cr.h, canvasW, canvasH - (cr.y + cr.h));
    // Left strip (between top and bottom)
    ctx.fillRect(0, cr.y, cr.x, cr.h);
    // Right strip (between top and bottom)
    ctx.fillRect(cr.x + cr.w, cr.y, canvasW - (cr.x + cr.w), cr.h);

    ctx.restore();
  }

  /**
   * Draw a subtle inner shadow / vignette just inside the container edges.
   */
  _drawContainerInnerShadow(ctx, cr) {
    const shadowWidth = 24;

    // Top inner shadow
    let grad = ctx.createLinearGradient(0, cr.y, 0, cr.y + shadowWidth);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cr.x, cr.y, cr.w, shadowWidth);

    // Bottom inner shadow
    grad = ctx.createLinearGradient(0, cr.y + cr.h, 0, cr.y + cr.h - shadowWidth);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cr.x, cr.y + cr.h - shadowWidth, cr.w, shadowWidth);

    // Left inner shadow
    grad = ctx.createLinearGradient(cr.x, 0, cr.x + shadowWidth, 0);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cr.x, cr.y, shadowWidth, cr.h);

    // Right inner shadow
    grad = ctx.createLinearGradient(cr.x + cr.w, 0, cr.x + cr.w - shadowWidth, 0);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cr.x + cr.w - shadowWidth, cr.y, shadowWidth, cr.h);
  }

  // ═══════════════════════════════════════════════════════
  // Private: container frame / border
  // ═══════════════════════════════════════════════════════

  /**
   * Draw the container border stroke.
   */
  _drawContainerBorder(ctx, cr) {
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.35)';
    ctx.lineWidth = CONTAINER_BORDER;
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.stroke();

    // Subtle inner border for depth
    const inset = 3;
    ctx.strokeStyle = 'rgba(180, 150, 100, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this._roundRect(ctx, cr.x + inset, cr.y + inset, cr.w - inset * 2, cr.h - inset * 2, CONTAINER_RADIUS - 1);
    ctx.stroke();
  }

  // ═══════════════════════════════════════════════════════
  // Private: labels / text
  // ═══════════════════════════════════════════════════════

  /**
   * Draw depth/floor indicators along the top of the container.
   * @param {CanvasRenderingContext2D} ctx — already translated to container origin
   * @param {number} cw — container width
   * @param {number} ch — container height
   */
  _drawDepthLabels(ctx, cw, ch) {
    if (!this._graph || !this._renderer) return;

    const positioned = this._renderer.layoutNodes(cw, ch);
    if (positioned.length === 0) return;

    ctx.save();
    ctx.fillStyle = 'rgba(180, 160, 120, 0.45)';
    ctx.font = '15px "Marcellus SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Group by depth and draw label above topmost node
    const depthMap = new Map();
    for (const { node, x, y } of positioned) {
      if (!depthMap.has(node.depth)) {
        depthMap.set(node.depth, { x, topY: y });
      } else {
        const prev = depthMap.get(node.depth);
        if (y < prev.topY) prev.topY = y;
      }
    }

    for (const [depth, info] of depthMap) {
      const label = depth === 0 ? 'START'
        : depth === this._graph.depthCount - 1 ? 'BOSS'
        : `FLOOR ${depth}`;
      ctx.fillText(label, info.x, Math.max(8, info.topY - 42));
    }

    ctx.restore();
  }

  /**
   * Draw info about the current node / legend at the bottom of the container.
   * @param {CanvasRenderingContext2D} ctx — already translated to container origin
   * @param {number} cw — container width
   * @param {number} ch — container height
   */
  _drawNodeInfo(ctx, cw, ch) {
    if (!this._traversal) return;

    const current = this._traversal.currentNode;
    if (!current) return;

    const typeName = current.type.charAt(0).toUpperCase() + current.type.slice(1);
    const text = `${typeName} — Depth ${current.depth + 1}`;

    ctx.save();
    ctx.fillStyle = 'rgba(220, 200, 160, 0.7)';
    ctx.font = '18px "Marcellus SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, cw / 2, ch - 12);
    ctx.restore();
  }

  /**
   * Draw a hint telling the player how to close the overlay.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   */
  _drawCloseHint(ctx, canvasW) {
    ctx.save();
    ctx.fillStyle = 'rgba(220, 200, 160, 0.6)';
    ctx.font = '14px "Marcellus SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Press M or Esc to close', canvasW / 2, 16);
    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════
  // Utility
  // ═══════════════════════════════════════════════════════

  /**
   * Helper: draw a rounded rectangle path.
   */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
