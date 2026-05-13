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

/** Base node circle radius in CSS pixels (for non-boss nodes) */
const NODE_RADIUS = 28;
/** Boss node radius multiplier */
const BOSS_RADIUS_MULT = 2;
/** Icon size fraction of node radius (fills most of the node) */
const ICON_SCALE = 0.92;
/** Horizontal padding on each side */
const H_PAD = 80;
/** Vertical padding on each side */
const V_PAD = 70;
/** Gap between connection dots (pixels) */
const DOT_GAP = 7;
/** Dot radius for connection lines */
const DOT_RADIUS = 3.0;
/** Alpha for neutral/default edges */
const EDGE_DEFAULT_ALPHA = 0.55;
/** Alpha for traversed/completed edges (darker) */
const EDGE_TRAVERSED_ALPHA = 0.28;
/** Alpha for available-next edges (brighter highlight) */
const EDGE_AVAILABLE_ALPHA = 0.85;
/** Alpha for edge path line behind dots */
const EDGE_PATH_ALPHA = 0.25;
/** Edge path line width */
const EDGE_PATH_WIDTH = 1.5;
/** Maximum control-point offset for curve (fraction of horizontal distance) */
const CURVE_FACTOR = 0.04;
/** Color for available-next edges (gold highlight) */
const EDGE_AVAILABLE_COLOR = '#d4a840';
/** Color for default edges */
const EDGE_DEFAULT_COLOR = '#b8a070';
/** Color for traversed edges */
const EDGE_TRAVERSED_COLOR = '#5a4a3a';
/** Path line color */
const EDGE_PATH_COLOR = '#a09070';
/** Pulse magnitude for available edges */
const EDGE_AVAILABLE_PULSE = 0.5;

// ── Type → icon asset key mapping ────────────────────
const ICON_MAP = {
  battle:   'map_icon_battle',
  elite:    'map_icon_elite',
  chest:    'map_icon_chest',
  training: 'map_icon_train',
  rest:     'map_icon_rest',
  boss:     'map_icon_boss',
};

// ── State-based highlight colors (NOT type-based) ────
/** Ring color for the current node (strongest highlight) */
const CURRENT_RING_COLOR = '#e8d860';
/** Glow color for the current node */
const CURRENT_GLOW_COLOR = '#c89820';
/** Ring color for available next nodes (different from current) */
const AVAILABLE_RING_COLOR = '#c8b878';
/** Glow color for available next nodes */
const AVAILABLE_GLOW_COLOR = '#8a7a50';

/**
 * Convert a hex color like '#3a2f1f' to an rgba string with given alpha.
 * @param {string} hex
 * @param {number} alpha
 * @returns {string}
 */
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
   * Get the visual radius for a node (boss nodes are 2x larger).
   * @param {MapNode} node
   * @returns {number}
   */
  _nodeRadius(node) {
    return node.type === 'boss' ? NODE_RADIUS * BOSS_RADIUS_MULT : NODE_RADIUS;
  }

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
      const r = this._nodeRadius(node) + 4; // slight padding for easier click
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

    // ── 1. Draw connection edges ──────────────────
    this._drawAllEdges(ctx, positioned, dt);

    // ── 2. Draw node containers and icons ─────────
    for (const { node, x, y } of positioned) {
      this._drawNode(ctx, node, x, y, dt);
    }
  }

  // ── Edges ──────────────────────────────────────────

  /**
   * Classify an edge into one of three visual states.
   * @param {MapNode} fromNode
   * @param {MapNode} toNode
   * @returns {'available'|'traversed'|'default'}
   */
  _edgeState(fromNode, toNode) {
    const fs = fromNode.state;
    const ts = toNode.state;

    // Available: from is current, to is directly reachable
    if (fs.current && ts.reachable) {
      return 'available';
    }

    // Traversed: both nodes have been completed (edge was travelled)
    if (fs.completed && ts.completed) {
      return 'traversed';
    }

    // Default: future, undiscovered, or otherwise neutral
    return 'default';
  }

  /**
   * Draw all connection edges as dotted curved paths with
   * state-based styling.
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
   * Draw a single edge between two nodes as a dotted curved line
   * over a subtle continuous path line. Styling varies by state:
   *   - available: bright gold highlight with pulse
   *   - traversed: darker, muted
   *   - default: neutral/natural
   */
  _drawEdge(ctx, fromNode, x1, y1, toNode, x2, y2, dt) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) return;

    const state = this._edgeState(fromNode, toNode);

    // Build the quadratic bezier curve
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const perpX = -dy / dist;
    const perpY = dx / dist;
    // Gentle, consistent curve — lane only shifts direction subtly
    const laneSign = ((fromNode.lane + toNode.lane) % 2 === 0) ? 1 : -1;
    const offset = dist * CURVE_FACTOR * laneSign;

    const cpX = midX + perpX * offset;
    const cpY = midY + perpY * offset;

    // ── 1. Subtle continuous path line behind the dots ──
    ctx.save();
    ctx.globalAlpha = EDGE_PATH_ALPHA;
    ctx.strokeStyle = EDGE_PATH_COLOR;
    ctx.lineWidth = EDGE_PATH_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cpX, cpY, x2, y2);
    ctx.stroke();
    ctx.restore();

    // ── 2. Dotted overlay — state-based styling ─────────
    ctx.save();

    let dotAlpha, dotColor, dotPulseMag;
    if (state === 'available') {
      dotAlpha = EDGE_AVAILABLE_ALPHA;
      dotColor = EDGE_AVAILABLE_COLOR;
      dotPulseMag = EDGE_AVAILABLE_PULSE;
    } else if (state === 'traversed') {
      dotAlpha = EDGE_TRAVERSED_ALPHA;
      dotColor = EDGE_TRAVERSED_COLOR;
      dotPulseMag = 0; // no pulse on traversed edges
    } else {
      dotAlpha = EDGE_DEFAULT_ALPHA;
      dotColor = EDGE_DEFAULT_COLOR;
      dotPulseMag = 0.3;
    }

    ctx.globalAlpha = dotAlpha;
    ctx.fillStyle = dotColor;

    const steps = Math.max(10, Math.floor(dist / DOT_GAP));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cpX + t * t * x2;
      const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cpY + t * t * y2;

      // Pulse animation only for available and default edges
      const pulse = dotPulseMag > 0
        ? Math.sin(dt * 0.002 + i * 0.35) * dotPulseMag
        : 0;
      const r = DOT_RADIUS + pulse;

      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Nodes ──────────────────────────────────────────

  /**
   * Draw a single node (circle + icon) with state-based highlighting.
   *
   * Highlighting rules (gameplay state only — NOT type-based):
   *   - Current node: strongest/clearest highlight (bright ring + glow + pulse)
   *   - Available next nodes: distinct highlight (different color ring + subtle glow)
   *   - Completed nodes: slightly darkened, no colored ring/glow, subtle checkmark
   *   - Future/undiscovered: natural asset color, no glow, no colored ring
   *   - Boss node: no special red treatment unless current or available
   */
  _drawNode(ctx, node, x, y, dt) {
    const traversal = this._traversal;
    const isHovered = this._hovered && this._hovered.nodeId === node.id;

    let iconAlpha = 1.0;
    let scale = 1.0;
    let isCurrent = false;       // player is on this node
    let isNextNode = false;      // reachable from current
    let isCompleted = false;     // already traversed

    if (traversal) {
      if (node.state.current) {
        isCurrent = true;
        scale = 1.12;
      } else if (node.state.reachable) {
        isNextNode = true;
        scale = 1.04;
      } else if (node.state.completed) {
        isCompleted = true;
        scale = 0.95;
        iconAlpha = 0.6;
      }
    }

    // Hover boost (only for reachable "next" nodes)
    if (isHovered && isNextNode) {
      scale = Math.min(1.12, scale + 0.04);
    }

    const baseRadius = this._nodeRadius(node);
    const r = baseRadius * scale;

    ctx.save();

    // ── Glow (only for current and available nodes) ──
    if (isCurrent) {
      const glowRadius = r * 1.8;
      const glowGrad = ctx.createRadialGradient(x, y, r * 0.6, x, y, glowRadius);
      glowGrad.addColorStop(0, hexToRgba(CURRENT_GLOW_COLOR, 0.4));
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    } else if (isNextNode) {
      const glowRadius = r * 1.5;
      const glowGrad = ctx.createRadialGradient(x, y, r * 0.6, x, y, glowRadius);
      glowGrad.addColorStop(0, hexToRgba(AVAILABLE_GLOW_COLOR, 0.22));
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    // Completed and neutral nodes: no glow

    // ── Dark backing circle (all nodes) ────────────
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const ringFillGrad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
    ringFillGrad.addColorStop(0, 'rgba(18, 12, 6, 0.92)');
    ringFillGrad.addColorStop(0.7, 'rgba(12, 8, 3, 0.96)');
    ringFillGrad.addColorStop(1, 'rgba(8, 4, 1, 1.0)');
    ctx.fillStyle = ringFillGrad;
    ctx.fill();

    // ── Colored ring (ONLY for current and available) ──
    if (isCurrent) {
      const ringColor = CURRENT_RING_COLOR;
      const ringWidth = 4;
      const hoverBoost = (isHovered && isNextNode) ? 0.5 : 0;

      // Pulsing outer glow ring
      const pulse = Math.sin(dt * 0.003) * 0.35 + 0.65;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.lineWidth = ringWidth + 4 + hoverBoost;
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Main ring on top
      ctx.globalAlpha = 1.0;
      ctx.lineWidth = ringWidth + hoverBoost;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner decorative ring (current only)
      ctx.beginPath();
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = ringColor;
      ctx.stroke();
    } else if (isNextNode) {
      const ringColor = AVAILABLE_RING_COLOR;
      const ringWidth = 3;
      const hoverBoost = isHovered ? 0.5 : 0;

      // Subtle pulse for reachable next nodes
      const pulse = Math.sin(dt * 0.003) * 0.2 + 0.8;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.lineWidth = ringWidth + 2 + hoverBoost;
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Main ring
      ctx.globalAlpha = 1.0;
      ctx.lineWidth = ringWidth + hoverBoost;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Completed and neutral nodes: NO colored ring

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
      ctx.fillStyle = isCurrent ? '#f0e8c0' : '#c0b890';
      ctx.font = `bold ${Math.floor(r * 0.8)}px "Marcellus SC", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = node.type.charAt(0).toUpperCase();
      ctx.fillText(letter, x, y + 1);
    }

    // ── Completed checkmark ────────────────────────
    if (node.state.completed && !node.state.current) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#a09070';
      ctx.font = `${Math.floor(r * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', x, y - r - 10);
    }

    ctx.restore();
  }
}
