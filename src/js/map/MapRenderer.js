/**
 * MapRenderer — draws the map graph to a Canvas2D context.
 *
 * Responsibilities:
 *   - Layout node positions within the canvas bounds
 *   - Draw parchment-style background
 *   - Draw dotted/curved connection edges between nodes
 *   - Draw node circles with type-specific icons
 *   - Apply state-based styling (current, completed, reachable, unreachable)
 *   - Handle hover/click hit-testing
 *
 * No game logic, no traversal state mutation, no scene management.
 *
 * @dependency MapGraph, MapTraversalController, AssetManager
 */

import MapNode from './MapNode.js';
import MapGraph from './MapGraph.js';

/** Node circle radius in CSS pixels */
const NODE_RADIUS = 28;
/** Icon size fraction of node radius */
const ICON_SCALE = 0.55;
/** Horizontal padding on each side */
const H_PAD = 80;
/** Vertical padding on each side */
const V_PAD = 70;
/** Gap between connection dots (pixels) */
const DOT_GAP = 8;
/** Dot radius for connection lines */
const DOT_RADIUS = 2.2;
/** Maximum control-point offset for curve (fraction of horizontal distance) */
const CURVE_FACTOR = 0.25;

// ── Type → icon asset key mapping ────────────────────
const ICON_MAP = {
  battle:   'map_icon_battle',
  elite:    'map_icon_elite',
  chest:    'map_icon_chest',
  training: 'map_icon_train',
  rest:     'map_icon_rest',
  boss:     'map_icon_boss',
};

// ── Type → container styling ─────────────────────────
const TYPE_STYLE = {
  battle:   { ringColor: '#8b7355', glowColor: '#3a2f1f' },
  elite:    { ringColor: '#c9a040', glowColor: '#5c3a0a' },
  chest:    { ringColor: '#5a8a6a', glowColor: '#1f3a28' },
  training: { ringColor: '#7a6a8a', glowColor: '#2a1f3a' },
  rest:     { ringColor: '#5a8aaa', glowColor: '#1f2f3a' },
  boss:     { ringColor: '#c04040', glowColor: '#5c0a0a' },
};

/** @param {string} type @returns {{ringColor:string,glowColor:string}} */
function styleForType(type) {
  return TYPE_STYLE[type] || TYPE_STYLE.battle;
}

export default class MapRenderer {
  /**
   * @param {object} services
   * @param {import('../engine/AssetManager.js').default} services.assetManager
   */
  constructor(services) {
    /** @type {import('../engine/AssetManager.js').default} */
    this._am = services.assetManager;

    /** @type {MapGraph|null} */
    this._graph = null;

    /** @type {import('./MapTraversalController.js').default|null} */
    this._traversal = null;

    /** @type {{nodeId:string, node:MapNode}|null} */
    this._hovered = null;
  }

  // ── Setters ────────────────────────────────────────

  /**
   * Set the graph to render.
   * @param {MapGraph} graph
   */
  setGraph(graph) {
    this._graph = graph;
  }

  /**
   * Set the traversal controller for state-based styling.
   * @param {import('./MapTraversalController.js').default} traversal
   */
  setTraversal(traversal) {
    this._traversal = traversal;
  }

  // ── Layout ─────────────────────────────────────────

  /**
   * Compute (x, y) positions for all nodes based on canvas dimensions.
   * Returns a flat array of {node, x, y}.
   * Call this whenever the canvas resizes.
   *
   * @param {number} canvasW
   * @param {number} canvasH
   * @returns {{node:MapNode, x:number, y:number}[]}
   */
  layoutNodes(canvasW, canvasH) {
    const graph = this._graph;
    if (!graph) return [];

    const depthCount = graph.depthCount;
    const mapAreaW = canvasW - H_PAD * 2;
    const mapAreaH = canvasH - V_PAD * 2;

    // Horizontal spacing between depths
    const colW = depthCount > 1 ? mapAreaW / (depthCount - 1) : mapAreaW;
    const startX = H_PAD;

    const positioned = [];

    for (let d = 0; d < depthCount; d++) {
      const nodes = graph.getNodesAtDepth(d);
      if (nodes.length === 0) continue;

      const x = startX + (d > 0 ? colW * d : 0);

      // Vertical distribution
      const count = nodes.length;
      if (count === 1) {
        const y = canvasH / 2;
        nodes[0].x = x;
        nodes[0].y = y;
        positioned.push({ node: nodes[0], x, y });
      } else {
        const spacing = Math.min(mapAreaH / (count - 1), 120);
        const totalH = spacing * (count - 1);
        const startY = (canvasH - totalH) / 2;

        for (let i = 0; i < count; i++) {
          const y = startY + spacing * i;
          nodes[i].x = x;
          nodes[i].y = y;
          positioned.push({ node: nodes[i], x, y });
        }
      }
    }

    return positioned;
  }

  // ── Hit testing ────────────────────────────────────

  /**
   * Find the node at the given canvas coordinates.
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} mx
   * @param {number} my
   * @returns {MapNode|null}
   */
  hitTest(canvasW, canvasH, mx, my) {
    const positioned = this.layoutNodes(canvasW, canvasH);
    for (const { node, x, y } of positioned) {
      const dx = mx - x;
      const dy = my - y;
      const r = NODE_RADIUS + 4; // slight padding for easier click
      if (dx * dx + dy * dy <= r * r) {
        return node;
      }
    }
    return null;
  }

  /**
   * Update hovered node.
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} mx
   * @param {number} my
   * @returns {boolean} true if hover changed
   */
  updateHover(canvasW, canvasH, mx, my) {
    const prevId = this._hovered ? this._hovered.nodeId : null;
    const node = this.hitTest(canvasW, canvasH, mx, my);

    if (node) {
      if (prevId !== node.id) {
        this._hovered = { nodeId: node.id, node };
        return true;
      }
    } else {
      if (this._hovered) {
        this._hovered = null;
        return true;
      }
    }
    return false;
  }

  // ── Render ─────────────────────────────────────────

  /**
   * Main render entry point.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} canvasW
   * @param {number} canvasH
   * @param {number} dt - delta time in ms (for subtle animations)
   */
  render(ctx, canvasW, canvasH, dt) {
    const graph = this._graph;
    if (!graph) return;

    const positioned = this.layoutNodes(canvasW, canvasH);

    // ── 1. Draw parchment background ──────────────
    this._drawBackground(ctx, canvasW, canvasH);

    // ── 2. Draw connection edges ──────────────────
    this._drawAllEdges(ctx, positioned, dt);

    // ── 3. Draw node containers and icons ─────────
    for (const { node, x, y } of positioned) {
      this._drawNode(ctx, node, x, y, dt);
    }
  }

  // ── Background ─────────────────────────────────────

  /**
   * Subtle parchment-style background with faint depth markers.
   */
  _drawBackground(ctx, w, h) {
    // Base fill — dark parchment tone
    ctx.save();

    // Gradient: dark edges, slightly lighter center
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, '#1e1810');
    grad.addColorStop(0.5, '#1a1410');
    grad.addColorStop(1, '#0d0a08');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle vertical parchment grain lines
    ctx.strokeStyle = 'rgba(100, 80, 50, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 4) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Edges ──────────────────────────────────────────

  /**
   * Draw all connection edges as dotted curved paths.
   */
  _drawAllEdges(ctx, positioned, dt) {
    const graph = this._graph;
    if (!graph) return;

    // Build a set of edges to avoid drawing duplicates
    const drawn = new Set();

    for (const { node, x, y } of positioned) {
      for (const outId of node.outgoing) {
        const edgeKey = `${node.id}->${outId}`;
        if (drawn.has(edgeKey)) continue;
        drawn.add(edgeKey);

        const target = graph.getNode(outId);
        if (!target) continue;

        this._drawEdge(ctx, node, x, y, target, target.x, target.y, dt);
      }
    }
  }

  /**
   * Draw a single edge between two nodes as a dotted curved line.
   */
  _drawEdge(ctx, fromNode, x1, y1, toNode, x2, y2, dt) {
    const traversal = this._traversal;

    // Determine edge visibility/styling from traversal state
    let alpha = 0.15;
    let color = '#6b5b4a';

    if (traversal) {
      if (fromNode.state.completed && toNode.state.completed) {
        // Both completed — solid visible path
        alpha = 0.6;
        color = '#8b7550';
      } else if (fromNode.state.completed && toNode.state.reachable) {
        // Path to reachable — highlighted
        alpha = 0.7;
        color = '#c9a840';
      } else if (fromNode.state.current || fromNode.state.completed) {
        // Active/completed parent → undiscovered child — partially visible
        alpha = 0.30;
        color = '#7b6a4a';
      }
    } else {
      alpha = 0.5;
      color = '#8b7550';
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) {
      ctx.restore();
      return;
    }

    // Build a simple quadratic bezier curve
    // Control point offset perpendicular to edge direction
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const perpX = -dy / dist;
    const perpY = dx / dist;
    const offset = dist * CURVE_FACTOR * (Math.sin(fromNode.lane * 0.7 + toNode.lane * 0.7) * 0.5 + 0.5);

    const cpX = midX + perpX * offset;
    const cpY = midY + perpY * offset;

    // Sample the bezier at regular intervals for dots
    const steps = Math.max(10, Math.floor(dist / DOT_GAP));

    ctx.fillStyle = color;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Quadratic bezier
      const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cpX + t * t * x2;
      const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cpY + t * t * y2;

      // Subtle pulse animation on reachable edges
      let r = DOT_RADIUS;
      if (traversal && fromNode.state.completed && toNode.state.reachable) {
        r += Math.sin(dt * 0.003 + i * 0.3) * 0.6;
      }

      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Nodes ──────────────────────────────────────────

  /**
   * Draw a single node (circle + icon) with state-based styling.
   */
  _drawNode(ctx, node, x, y, dt) {
    const traversal = this._traversal;
    const isHovered = this._hovered && this._hovered.nodeId === node.id;

    let ringAlpha = 0.55;
    let iconAlpha = 0.5;
    let ringWidth = 2.5;
    let scale = 1.0;

    const style = styleForType(node.type);

    if (traversal) {
      if (node.state.current) {
        ringAlpha = 1.0;
        iconAlpha = 1.0;
        ringWidth = 4;
        scale = 1.12;
      } else if (node.state.completed) {
        ringAlpha = 0.8;
        iconAlpha = 0.85;
        ringWidth = 2.5;
        scale = 0.95;
      } else if (node.state.reachable) {
        ringAlpha = 0.85;
        iconAlpha = 0.9;
        ringWidth = 3;
        scale = 1.05;
      } else {
        ringAlpha = 0.35;
        iconAlpha = 0.3;
        ringWidth = 2;
      }
    }

    // Hover boost
    if (isHovered && node.state.reachable) {
      ringAlpha = Math.min(1.0, ringAlpha + 0.15);
      iconAlpha = Math.min(1.0, iconAlpha + 0.1);
      ringWidth += 1;
      scale = Math.min(1.2, scale + 0.03);
    }

    const r = NODE_RADIUS * scale;

    ctx.save();

    // ── Glow (under the node) ──────────────────────
    if (node.state.current || node.state.reachable) {
      const glowGrad = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.6);
      const glowAlpha = node.state.current ? 0.35 : 0.18;
      glowGrad.addColorStop(0, style.glowColor.replace(')', `,${glowAlpha})`).replace('rgb', 'rgba'));
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Outer ring ─────────────────────────────────
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);

    // Ring fill — dark semi-transparent
    const ringFillGrad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
    ringFillGrad.addColorStop(0, 'rgba(30, 22, 14, 0.85)');
    ringFillGrad.addColorStop(1, 'rgba(20, 14, 8, 0.9)');
    ctx.fillStyle = ringFillGrad;
    ctx.fill();

    // Ring stroke
    ctx.lineWidth = ringWidth;
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = style.ringColor;
    ctx.stroke();

    // Inner decorative ring
    if (node.state.current || node.state.reachable) {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.globalAlpha = ringAlpha * 0.5;
      ctx.strokeStyle = style.ringColor;
      ctx.stroke();
    }

    // ── Icon ───────────────────────────────────────
    const iconKey = ICON_MAP[node.type] || 'map_icon_battle';
    const iconImg = this._am ? this._am.get(iconKey) : null;

    if (iconImg && iconImg.complete) {
      ctx.globalAlpha = iconAlpha;
      const iconSize = r * 2 * ICON_SCALE;
      const ix = x - iconSize / 2;
      const iy = y - iconSize / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(iconImg, ix, iy, iconSize, iconSize);
    } else {
      // Fallback: type letter
      ctx.globalAlpha = iconAlpha;
      ctx.fillStyle = '#c0b890';
      ctx.font = `bold ${Math.floor(r * 0.8)}px "Marcellus SC", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = node.type.charAt(0).toUpperCase();
      ctx.fillText(letter, x, y + 1);
    }

    // ── Boss special treatment ─────────────────────
    if (node.type === 'boss') {
      ctx.globalAlpha = ringAlpha;
      // Hexagonal outer shape
      this._drawHexRing(ctx, x, y, r * 1.25, ringWidth, style.ringColor);
    }

    // ── Completed checkmark ────────────────────────
    if (node.state.completed && !node.state.current) {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#c9a840';
      ctx.font = `${Math.floor(r * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', x, y - r - 12);
    }

    ctx.restore();
  }

  /**
   * Draw a hexagonal ring around a point (for boss nodes).
   */
  _drawHexRing(ctx, cx, cy, radius, lineWidth, color) {
    const sides = 6;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (Math.PI / sides) * (2 * i - 1);
      const px = cx + radius * Math.cos(angle);
      const py = cy + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.lineWidth = lineWidth * 0.7;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}
