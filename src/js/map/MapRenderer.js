/**
 * MapRenderer — draws the map graph to a Canvas2D context.
 *
 * Responsibilities:
 *   - Layout node positions within the canvas bounds (diagonal fan-out)
 *   - Draw parchment-style background
 *   - Draw dotted/curved connection edges between nodes
 *   - Draw node circles with type-specific icons
 *   - Apply state-based styling (current, available, past, default)
 *   - Handle hover/click hit-testing
 *
 * Three visual states (replaces the old 4-state + exactRoute model):
 *   current   — strongest gold ring + glow + pulse (primary focus)
 *   available — distinct warm ring + glow (only directly reachable nodes)
 *   past      — darkened, desaturated (all nodes on floors behind the player)
 *   default   — natural asset color, no special treatment (future/unreachable)
 *
 * Edge hierarchy (simplified from 4 states):
 *   available — current → reachable next nodes (bright gold, strongest)
 *   traveled  — edges originating from past floors (dark muted)
 *   default   — future, undiscovered, neutral (dim grey, most subdued)
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
const H_PAD = 130;
/** Vertical padding on each side */
const V_PAD = 70;
/** Gap between connection dots (pixels) */
const DOT_GAP = 7;
/** Dot radius for connection lines */
const DOT_RADIUS = 3.0;
/** Maximum control-point offset for curve (fraction of horizontal distance) */
const CURVE_FACTOR = 0.04;

// ── Diagonal fan-out layout ────────────────────
/** Horizontal spread factor for diagonal fan-out (fraction of column width).
 *  Higher values create more dramatic diagonal slant. */
const DIAGONAL_SPREAD = 0.22;

// ── Edge colors (rebalanced: default=dim grey, available=bright gold, traveled=dark muted) ──
/** Alpha for neutral/default edges (dim grey, most subdued) */
const EDGE_DEFAULT_ALPHA = 0.38;
/** Alpha for traveled/past edges (darkened, muted) */
const EDGE_TRAVELED_ALPHA = 0.28;
/** Alpha for available-next edges (brightest highlight) */
const EDGE_AVAILABLE_ALPHA = 0.90;
/** Alpha for edge path line behind dots */
const EDGE_PATH_ALPHA = 0.18;
/** Edge path line width */
const EDGE_PATH_WIDTH = 1.5;

/** Color for default/inactive edges (dim grey — the most subdued) */
const EDGE_DEFAULT_COLOR = '#5a5a54';
/** Color for available-next edges (bright gold highlight) */
const EDGE_AVAILABLE_COLOR = '#c8b870';
/** Color for traveled/past edges (darkened, desaturated) */
const EDGE_TRAVELED_COLOR = '#4a3a2a';
/** Path line color (subtle continuous line behind dots) */
const EDGE_PATH_COLOR = '#6a6a64';

/** Pulse magnitude for available edges */
const EDGE_AVAILABLE_PULSE = 0.5;
/** Subtle pulse on default edges */
const EDGE_DEFAULT_PULSE = 0.10;

// ── Type → icon asset key mapping ────────────────────
const ICON_MAP = {
  battle:   'map_icon_battle',
  elite:    'map_icon_elite',
  chest:    'map_icon_chest',
  training: 'map_icon_train',
  rest:     'map_icon_rest',
  boss:     'map_icon_boss',
};

// ── State-based highlight colors ──────────────────────
/** Ring color for the current node (bright gold, distinct from available) */
const CURRENT_RING_COLOR = '#f0e040';
/** Glow color for the current node */
const CURRENT_GLOW_COLOR = '#d4a020';
/** Ring color for available next nodes (softer warm tone, clearly
  * different from the bright-gold current-node ring) */
const AVAILABLE_RING_COLOR = '#c8b870';
/** Glow color for available next nodes */
const AVAILABLE_GLOW_COLOR = '#8a7a4a';

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
   *
   * Uses a diagonal fan-out layout: nodes within the same depth are spread
   * horizontally based on their lane position, creating a roguelike zigzag
   * pattern where paths between depths form diagonal connections rather
   * than a rigid vertical grid.
   *
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

    // Max horizontal offset per node (fraction of column width)
    const maxSpread = colW * DIAGONAL_SPREAD;

    const positioned = [];

    for (let d = 0; d < depthCount; d++) {
      const nodes = graph.getNodesAtDepth(d);
      if (nodes.length === 0) continue;

      const baseX = startX + (d > 0 ? colW * d : 0);
      const count = nodes.length;

      // Alternate fan direction per depth for organic zigzag feel
      const direction = (d % 2 === 0) ? 1 : -1;

      // Vertical distribution
      if (count === 1) {
        const x = baseX;
        const y = canvasH / 2;
        nodes[0].x = x;
        nodes[0].y = y;
        positioned.push({ node: nodes[0], x, y });
      } else {
        const spacing = Math.min(mapAreaH / (count - 1), 120);
        const totalH = spacing * (count - 1);
        const startY = (canvasH - totalH) / 2;

        for (let i = 0; i < count; i++) {
          // Lane position 0..1 across the nodes in this depth
          const t = count > 1 ? i / (count - 1) : 0.5;
          // Diagonal offset: nodes spread horizontally based on lane
          // Top lanes shift one way, bottom lanes the opposite
          const offset = (t - 0.5) * maxSpread * direction;

          const x = baseX + offset;
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
   *
   * Priority order:
   *   1. 'available' — current node → reachable next node (bright gold)
   *   2. 'traveled'  — edge originates from a past floor (dark muted)
   *   3. 'default'   — future, undiscovered, neutral (dim grey)
   *
   * @param {MapNode} fromNode
   * @param {MapNode} toNode
   * @returns {'available'|'traveled'|'default'}
   */
  _edgeState(fromNode, toNode) {
    const fs = fromNode.state;

    // 1. Available: from is current, to is directly reachable
    if (fs.current && toNode.state.reachable) {
      return 'available';
    }

    // 2. Traveled: edge originates from a floor the player has left behind.
    //    All edges starting from past floors use the subdued "traveled" style,
    //    whether the player actually traversed them or bypassed them.
    if (this._traversal) {
      const effectiveDepth = this._traversal.getEffectiveCurrentDepth();
      if (fromNode.depth < effectiveDepth) {
        return 'traveled';
      }
    }

    // 3. Default: future, undiscovered, or otherwise neutral
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
   *   - available: bright gold highlight with pulse (strongest)
   *   - traveled:  dark, muted (past floors)
   *   - default:   dim grey, most subdued (future/undiscovered)
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
    if (state === 'traveled') {
      ctx.globalAlpha = EDGE_PATH_ALPHA * 0.45;
      ctx.strokeStyle = EDGE_TRAVELED_COLOR;
      ctx.lineWidth = EDGE_PATH_WIDTH * 0.6;
    } else if (state === 'available') {
      ctx.globalAlpha = EDGE_PATH_ALPHA * 1.4;
      ctx.strokeStyle = EDGE_AVAILABLE_COLOR;
      ctx.lineWidth = EDGE_PATH_WIDTH + 0.5;
    } else {
      ctx.globalAlpha = EDGE_PATH_ALPHA;
      ctx.strokeStyle = EDGE_PATH_COLOR;
      ctx.lineWidth = EDGE_PATH_WIDTH;
    }
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
    } else if (state === 'traveled') {
      dotAlpha = EDGE_TRAVELED_ALPHA;
      dotColor = EDGE_TRAVELED_COLOR;
      dotPulseMag = 0;
    } else {
      dotAlpha = EDGE_DEFAULT_ALPHA;
      dotColor = EDGE_DEFAULT_COLOR;
      dotPulseMag = EDGE_DEFAULT_PULSE;
    }

    ctx.globalAlpha = dotAlpha;
    ctx.fillStyle = dotColor;

    // Available edges get a subtle shadow/glow on dots
    if (state === 'available') {
      ctx.shadowColor = EDGE_AVAILABLE_COLOR;
      ctx.shadowBlur = 6;
    }

    const steps = Math.max(10, Math.floor(dist / DOT_GAP));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cpX + t * t * x2;
      const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cpY + t * t * y2;

      // Pulse animation for available and default edges
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
   * State priority (strongest → weakest):
   *   1. Current node   — strongest gold ring + glow + pulse (primary focus)
   *   2. Available next — warm ring + subtle glow (selectable, only reachable)
   *   3. Past           — darkened, desaturated (floors behind the player)
   *   4. Default        — natural asset color, no special treatment (future)
   *
   * Boss nodes receive NO special type-based treatment outside of state.
   */
  _drawNode(ctx, node, x, y, dt) {
    const traversal = this._traversal;
    const isHovered = this._hovered && this._hovered.nodeId === node.id;

    let iconAlpha = 1.0;
    let scale = 1.0;
    let isCurrent = false;
    let isAvailable = false;
    let isPast = false;

    if (traversal) {
      const effectiveDepth = traversal.getEffectiveCurrentDepth();

      if (node.state.current) {
        // Priority 1: current node — strongest focus
        isCurrent = true;
        scale = 1.12;
      } else if (node.state.reachable) {
        // Priority 2: directly reachable from current
        isAvailable = true;
        scale = 1.04;
      } else if (node.depth < effectiveDepth) {
        // Priority 3: on a floor the player has left behind
        // All past-floor nodes get uniform "traveled" treatment —
        // no distinction between visited vs bypassed.
        isPast = true;
        scale = 0.90;
        iconAlpha = 0.45;
      }
      // Priority 4: default — future/unreachable, no special treatment
    }

    // Hover boost (only for available "next" nodes)
    if (isHovered && isAvailable) {
      scale = Math.min(1.12, scale + 0.04);
    }

    const baseRadius = this._nodeRadius(node);
    const r = baseRadius * scale;

    ctx.save();

    // ── Glow (only for current and available nodes) ──
    if (isCurrent) {
      const glowRadius = r * 1.9;
      const glowGrad = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowRadius);
      glowGrad.addColorStop(0, hexToRgba(CURRENT_GLOW_COLOR, 0.45));
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    } else if (isAvailable) {
      const glowRadius = r * 1.6;
      const glowGrad = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowRadius);
      glowGrad.addColorStop(0, hexToRgba(AVAILABLE_GLOW_COLOR, 0.25));
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    // Past and default nodes: no glow

    // ── Base backing circle (all nodes, lighter and translucent) ──
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const ringFillGrad = ctx.createRadialGradient(x, y, r * 0.4, x, y, r);
    ringFillGrad.addColorStop(0, 'rgba(22, 14, 8, 0.78)');
    ringFillGrad.addColorStop(0.7, 'rgba(14, 8, 4, 0.88)');
    ringFillGrad.addColorStop(1, 'rgba(8, 4, 2, 0.94)');
    ctx.fillStyle = ringFillGrad;
    ctx.fill();

    // ── Past-floor darkening overlay ───────────────
    // Applies uniformly to all nodes on floors behind the player.
    if (isPast) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 4, 2, 0.42)';
      ctx.fill();
    }

    // ── Colored ring (ONLY for current and available) ──
    if (isCurrent) {
      const ringColor = CURRENT_RING_COLOR;

      // Pulsing outer glow ring (wider, stronger)
      const pulse = Math.sin(dt * 0.003) * 0.3 + 0.7;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 5;
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Main ring on top (clean, no glow halo)
      ctx.globalAlpha = 1.0;
      ctx.lineWidth = 4;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner decorative ring (current only — reinforces distinctness)
      ctx.beginPath();
      ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = ringColor;
      ctx.stroke();
    } else if (isAvailable) {
      const ringColor = AVAILABLE_RING_COLOR;
      const hoverBoost = isHovered ? 1 : 0;

      // Subtle pulse
      const pulse = Math.sin(dt * 0.003) * 0.18 + 0.82;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 4 + hoverBoost;
      ctx.shadowColor = ringColor;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Main ring
      ctx.globalAlpha = 1.0;
      ctx.lineWidth = 3 + hoverBoost;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = ringColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Past and default nodes: NO colored ring

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

    // ── Checkmark for completed (visited) nodes ──
    // Only show on past-floor nodes that the player actually visited.
    // This is the ONLY distinction between visited and bypassed past nodes.
    if (isPast && traversal && traversal.isOnExactRoute(node.id)) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#b89858';
      ctx.font = `${Math.floor(r * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', x, y - r - 10);
    }

    ctx.restore();
  }
}
