import MapNode from './MapNode.js';
import MapGraph from './MapGraph.js';

/**
 * MapTraversalController — manages traversal state on a MapGraph.
 *
 * Responsibilities:
 *   - Track which node the player is currently at
 *   - Mark nodes as discovered / reachable / completed
 *   - Determine valid next nodes the player can travel to
 *   - Enforce traversal rules (only connected edges from current)
 *   - Persist state independent of rendering or combat
 *
 * Usage:
 *   const ctrl = new MapTraversalController(graph);
 *   ctrl.moveTo('node_5');
 *   const nextOptions = ctrl.getReachableNodes();
 *
 * No coupling to rendering, UI, combat, or rewards.
 */
export default class MapTraversalController {
  /**
   * @param {MapGraph} graph
   */
  constructor(graph) {
    /** @type {MapGraph} */
    this._graph = graph;

    /** @type {string|null} current node id */
    this._currentNodeId = null;

    /** @type {string[]} ordered history of visited node ids */
    this._history = [];

    // Initialize: find the starting node and set it as current
    const startNodes = graph.getNodesAtDepth(0);
    if (startNodes.length > 0) {
      this._setCurrent(startNodes[0].id);
    }
  }

  // ── Accessors ──────────────────────────────────────

  /** @returns {MapGraph} */
  get graph() { return this._graph; }

  /** @returns {MapNode|null} */
  get currentNode() {
    return this._currentNodeId ? this._graph.getNode(this._currentNodeId) : null;
  }

  /** @returns {string|null} */
  get currentNodeId() { return this._currentNodeId; }

  /** @returns {string[]} */
  get history() { return [...this._history]; }

  /**
   * Get all nodes directly reachable from the current node.
   * These are nodes connected via outgoing edges from the current node.
   * @returns {MapNode[]}
   */
  getReachableNodes() {
    const current = this.currentNode;
    if (!current) return [];

    const reached = [];
    for (const outId of current.outgoing) {
      const node = this._graph.getNode(outId);
      if (node) reached.push(node);
    }
    return reached;
  }

  /**
   * Get all nodes the player has visited.
   * @returns {MapNode[]}
   */
  getCompletedNodes() {
    return this._history
      .map(id => this._graph.getNode(id))
      .filter(Boolean);
  }

  /**
   * Check if a node is currently reachable.
   * When a current node is set, checks its outgoing edges.
   * When no current node is set (e.g. after completeCurrentAndRevealNext),
   * falls back to checking the node's reachable state flag.
   * @param {string} nodeId
   * @returns {boolean}
   */
  isReachable(nodeId) {
    const current = this.currentNode;
    if (current) {
      return current.outgoing.includes(nodeId);
    }
    // No current node — check the state flag set by completeCurrentAndRevealNext()
    const node = this._graph.getNode(nodeId);
    return node ? node.state.reachable : false;
  }

  /**
   * Check if a node has been completed.
   * @param {string} nodeId
   * @returns {boolean}
   */
  isCompleted(nodeId) {
    return this._history.includes(nodeId);
  }

  /**
   * Get the effective current depth for rendering state decisions.
   * Uses the current node's depth if available; otherwise falls back
   * to the maximum depth in the history (after completeAndReveal).
   * @returns {number}
   */
  getEffectiveCurrentDepth() {
    const current = this.currentNode;
    if (current) return current.depth;
    if (this._history.length > 0) {
      let maxDepth = 0;
      for (const id of this._history) {
        const node = this._graph.getNode(id);
        if (node && node.depth > maxDepth) maxDepth = node.depth;
      }
      return maxDepth;
    }
    return 0;
  }

  /**
   * Check if a node is on the player's exact traveled route (in history).
   * @param {string} nodeId
   * @returns {boolean}
   */
  isOnExactRoute(nodeId) {
    return this._history.includes(nodeId);
  }

  /**
   * Check if an edge fromId → toId is part of the exact route the player took.
   * True when fromId and toId are consecutive entries in the history array.
   * @param {string} fromId
   * @param {string} toId
   * @returns {boolean}
   */
  isEdgeOnExactRoute(fromId, toId) {
    const fromIdx = this._history.indexOf(fromId);
    if (fromIdx === -1) return false;
    return this._history[fromIdx + 1] === toId;
  }

  /**
   * Check if a depth is in the past (≤ effective current depth).
   * @param {number} depth
   * @returns {boolean}
   */
  isPastDepth(depth) {
    return depth <= this.getEffectiveCurrentDepth();
  }

  /**
   * Check if a node is on a past/current-depth floor but was NOT visited
   * by the player (alternate path bypassed). These should render as
   * "generic past" rather than "future."
   * @param {string} nodeId
   * @returns {boolean}
   */
  isPastFloorBypassedNode(nodeId) {
    const node = this._graph.getNode(nodeId);
    if (!node) return false;
    // Must be on a past or current-depth floor
    if (!this.isPastDepth(node.depth)) return false;
    // Must NOT be the current node
    if (node.state.current) return false;
    // Must NOT have been visited (not in history)
    return !this._history.includes(nodeId);
  }

  /**
   * Move the player to a new node.
   * Validates that the target is reachable from the current node.
   * Marks current as completed, updates reachable/current states.
   *
   * @param {string} nodeId
   * @returns {boolean} true if move was successful
   */
  moveTo(nodeId) {
    const target = this._graph.getNode(nodeId);
    if (!target) return false;

    // Validate reachable
    if (!this.isReachable(nodeId)) {
      console.warn(`MapTraversalController: node "${nodeId}" is not reachable from current.`);
      return false;
    }

    // Complete current
    const current = this.currentNode;
    if (current) {
      current.state.current = false;
      current.state.completed = true;
    }

    // Push to history
    this._history.push(nodeId);

    // Set new current
    this._setCurrent(nodeId);

    return true;
  }

  /**
   * Force-set the current node without validation (for init / load).
   * Does NOT mark outgoing nodes as reachable — use revealNextDepth()
   * for that, so the player must complete the current node first.
   * @param {string} nodeId
   */
  _setCurrent(nodeId) {
    // Clear all current flags
    for (const node of this._graph.allNodes) {
      node.state.current = false;
      node.state.reachable = false;
    }

    const node = this._graph.getNode(nodeId);
    if (!node) return;

    this._currentNodeId = nodeId;

    // Mark as discovered + current
    node.state.discovered = true;
    node.state.current = true;
  }

  /**
   * Complete the current node (mark it as cleared) and reveal
   * all of its outgoing nodes as reachable for the next move.
   * Call this after the player finishes the encounter at the current node.
   */
  completeCurrentAndRevealNext() {
    const current = this.currentNode;
    if (!current) return;

    // Mark current as completed
    current.state.current = false;
    current.state.completed = true;
    this._currentNodeId = null;

    // Reveal all outgoing nodes as reachable
    for (const outId of current.outgoing) {
      const outNode = this._graph.getNode(outId);
      if (outNode) {
        outNode.state.discovered = true;
        outNode.state.reachable = true;
      }
    }
  }

  /**
   * Check if the current node is the boss node.
   * @returns {boolean}
   */
  isAtBoss() {
    const current = this.currentNode;
    return current ? current.type === 'boss' : false;
  }

  /**
   * Check if the current node's depth is the final depth (boss depth).
   * @returns {boolean}
   */
  isAtFinalDepth() {
    const current = this.currentNode;
    return current ? current.depth === this._graph.depthCount - 1 : false;
  }

  /**
   * Serialize traversal state for save/load.
   * Only stores node state changes, not the graph topology.
   * @returns {object}
   */
  serialize() {
    const nodeStates = {};
    for (const node of this._graph.allNodes) {
      nodeStates[node.id] = { ...node.state };
    }
    return {
      currentNodeId: this._currentNodeId,
      history: [...this._history],
      nodeStates,
    };
  }

  /**
   * Restore traversal state from a saved snapshot.
   * @param {object} data
   */
  deserialize(data) {
    this._currentNodeId = data.currentNodeId;
    this._history = data.history ? [...data.history] : [];

    if (data.nodeStates) {
      for (const [id, state] of Object.entries(data.nodeStates)) {
        const node = this._graph.getNode(id);
        if (node) {
          Object.assign(node.state, state);
        }
      }
    }
  }
}
