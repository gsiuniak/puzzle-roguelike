/**
 * MapView — reusable map rendering component.
 *
 * Extracts all visual rendering from MapScene so the exact same map screen
 * can be used in two modes:
 *
 *   'fullscreen' — standalone MapScene (dark overlay + contained splash)
 *   'overlay'    — BattleScene overlay (dark backdrop + contained splash)
 *
 * Both modes share identical:
 *   - Container layout (16:9, centered, rounded rect — acts as clip mask)
 *   - Dark semi-transparent fullscreen overlay background
 *   - Parchment splash filling the container interior only
 *   - Node/path rendering (via MapRenderer)
 *   - Depth/floor labels
 *   - Node info text
 *   - No visible border/stroke/outline on the container
 *
 * @dependency MapRenderer, MapGraph, AssetManager
 */

// ── Container layout constants (identical to MapScene) ──
/** Fraction of canvas width the container occupies */
const CONTAINER_WIDTH_FRAC = 0.95;
/** Fraction of canvas height the container occupies */
const CONTAINER_HEIGHT_FRAC = 0.95;
/** Minimum horizontal padding from edges */
const CONTAINER_MIN_H_PAD = 50;
/** Minimum vertical padding from edges */
const CONTAINER_MIN_V_PAD = 24;
/** Container corner radius */
const CONTAINER_RADIUS = 16;
/** Backdrop alpha for the dark overlay covering the entire canvas */
const BACKDROP_ALPHA = 0.75;

// ── Overlay animation constants ──
/** Duration of the overlay crossfade (ms) */
const OVERLAY_FADE_DURATION = 170;
/** Fraction of canvas height the panel slides */
const OVERLAY_SLIDE_FRACTION = 0.10;

/**
 * Overlay animation state enum.
 * @readonly
 * @enum {string}
 */
const OverlayState = Object.freeze({
  CLOSED: 'closed',
  OPENING: 'opening',
  OPEN: 'open',
  CLOSING: 'closing',
});

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

    // ── Overlay animation state ──
    /** @type {string} one of OverlayState values */
    this._overlayState = OverlayState.CLOSED;
    /** @type {number} elapsed animation time in ms */
    this._overlayTimer = 0;
  }

  // ═══════════════════════════════════════════════════════
  // Overlay animation API (used by BattleScene)
  // ═══════════════════════════════════════════════════════

  /**
   * Begin the overlay open animation (CLOSED → OPENING).
   * No-op if already open or currently opening.
   */
  openOverlay() {
    if (this._overlayState === OverlayState.OPEN || this._overlayState === OverlayState.OPENING) return;
    this._overlayState = OverlayState.OPENING;
    this._overlayTimer = 0;
  }

  /**
   * Begin the overlay close animation (OPEN → CLOSING).
   * No-op if already closed or currently closing.
   */
  closeOverlay() {
    if (this._overlayState === OverlayState.CLOSED || this._overlayState === OverlayState.CLOSING) return;
    this._overlayState = OverlayState.CLOSING;
    this._overlayTimer = 0;
  }

  /** @returns {boolean} true if the overlay is not CLOSED */
  isOverlayActive() {
    return this._overlayState !== OverlayState.CLOSED;
  }

  /** @returns {boolean} true while an animation is in progress */
  isOverlayAnimating() {
    return this._overlayState === OverlayState.OPENING || this._overlayState === OverlayState.CLOSING;
  }

  /** @returns {string} the current OverlayState value */
  getOverlayState() {
    return this._overlayState;
  }

  /**
   * Advance the overlay animation timer.
   * Call once per frame from the owning scene's update().
   * @param {number} dt — delta time in ms
   */
  updateOverlayAnimation(dt) {
    if (this._overlayState !== OverlayState.OPENING && this._overlayState !== OverlayState.CLOSING) return;

    this._overlayTimer += dt;

    if (this._overlayTimer >= OVERLAY_FADE_DURATION) {
      if (this._overlayState === OverlayState.OPENING) {
        this._overlayState = OverlayState.OPEN;
      } else {
        this._overlayState = OverlayState.CLOSED;
      }
    }
  }

  /**
   * Force-reset the overlay to CLOSED with no animation.
   * Use when the owning scene is exiting to ensure clean state.
   */
  resetOverlay() {
    this._overlayState = OverlayState.CLOSED;
    this._overlayTimer = 0;
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
   * Render the map in fullscreen mode (standalone MapScene).
   * Dark semi-transparent overlay covering the full canvas,
   * parchment splash contained entirely within the map panel.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} dt - delta time in ms
   */
  renderFullscreen(ctx, canvasW, canvasH, dt) {
    const cr = this.getContainerRect(canvasW, canvasH);

    // (battle background + dark backdrop are painted full-canvas by
    //  MapScene.renderBackground before the viewport clip is applied)

    // 2. Parchment splash background inside the container (clipped)
    this._drawSplashInsideContainer(ctx, cr);

    // 3. Clip & translate to container interior
    ctx.save();
    ctx.beginPath();
    this._roundRect(ctx, cr.x, cr.y, cr.w, cr.h, CONTAINER_RADIUS);
    ctx.clip();
    ctx.translate(cr.x, cr.y);

    // 4. MapRenderer — nodes + paths
    if (this._renderer) {
      this._renderer.render(ctx, cr.w, cr.h, dt, 1);
    }

    // 5. Node info at bottom
    this._drawNodeInfo(ctx, cr.w, cr.h);

    ctx.restore();
  }

  /**
   * Render the map in overlay mode (for BattleScene).
   * Dark semi-transparent backdrop covering the entire physical canvas
   * (including letterbox/pillarbox bars), then the map container with
   * parchment splash background inside, framed identically to the
   * standalone map. The caller passes `app` so the backdrop can escape
   * the design-space viewport clip via `fillFullCanvas`.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} dt - delta time in ms
   * @param {import('../engine/CanvasApp.js').default} [app] - optional
   *   CanvasApp used to draw the backdrop full-canvas. When omitted, falls
   *   back to a design-space fillRect (legacy behavior).
   */
  renderOverlay(ctx, canvasW, canvasH, dt, app) {
    // ── Compute animation parameters ──
    let overlayAlpha = 1;
    let containerSlideY = 0;

    if (this._overlayState === OverlayState.CLOSED) {
      return; // nothing to render
    }

    if (this._overlayState === OverlayState.OPENING) {
      const rawT = Math.min(1, this._overlayTimer / OVERLAY_FADE_DURATION);
      // ease-out cubic: fast start, gentle settle
      const easedT = 1 - Math.pow(1 - rawT, 3);
      overlayAlpha = easedT;
      containerSlideY = (1 - easedT) * canvasH * OVERLAY_SLIDE_FRACTION;
    } else if (this._overlayState === OverlayState.CLOSING) {
      const rawT = Math.min(1, this._overlayTimer / OVERLAY_FADE_DURATION);
      // ease-in cubic: gentle start, fast exit
      const easedT = Math.pow(rawT, 3);
      overlayAlpha = 1 - easedT;
      containerSlideY = easedT * canvasH * OVERLAY_SLIDE_FRACTION;
    }
    // OPEN state: overlayAlpha=1, containerSlideY=0 (defaults)

    const cr = this.getContainerRect(canvasW, canvasH);
    // Container Y is shifted downward by the slide offset
    const slideCr = { x: cr.x, y: cr.y + containerSlideY, w: cr.w, h: cr.h };

    // 1. Dark semi-transparent backdrop covering the entire physical canvas
    //    (including letterbox/pillarbox bars). Fades with overlayAlpha but
    //    does NOT slide.
    if (app && typeof app.fillFullCanvas === 'function') {
      app.fillFullCanvas(`rgba(0, 0, 0, ${BACKDROP_ALPHA * overlayAlpha})`);
    } else {
      ctx.save();
      ctx.fillStyle = `rgba(0, 0, 0, ${BACKDROP_ALPHA * overlayAlpha})`;
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.restore();
    }

    // 2. Map panel with combined fade + slide
    ctx.save();
    ctx.globalAlpha = overlayAlpha;

    // 2a. Parchment splash background inside the container (clipped)
    this._drawSplashInsideContainer(ctx, slideCr);

    // 2b. Clip & translate to container interior
    ctx.beginPath();
    this._roundRect(ctx, slideCr.x, slideCr.y, slideCr.w, slideCr.h, CONTAINER_RADIUS);
    ctx.clip();
    ctx.translate(slideCr.x, slideCr.y);

    // 2c. MapRenderer — nodes + paths (inherit overlay fade alpha)
    if (this._renderer) {
      this._renderer.render(ctx, slideCr.w, slideCr.h, dt, overlayAlpha);
    }

    // 2d. Node info at bottom
    this._drawNodeInfo(ctx, slideCr.w, slideCr.h);

    ctx.restore();

    // 3. "Press M or Esc to close" hint at top (fades with overlay)
    this._drawCloseHint(ctx, canvasW, overlayAlpha);
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
  // Private: splash background
  // ═══════════════════════════════════════════════════════

  /**
   * Draw the map_splash image scaled to cover the container interior exactly.
   * The container's rounded-rect clip path ensures the splash does not
   * bleed outside the container bounds.
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
  _drawCloseHint(ctx, canvasW, alpha = 1) {
    ctx.save();
    ctx.fillStyle = `rgba(220, 200, 160, ${0.6 * alpha})`;
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
