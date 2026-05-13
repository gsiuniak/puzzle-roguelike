import MapNode from './MapNode.js';

/**
 * MapGraph — the full map data structure.
 *
 * Immutable once generated. Holds all nodes keyed by id and provides
 * query helpers. Positions (x, y) are computed by MapRenderer, not here.
 *
 * @property {Map<string, MapNode>} _nodes
 * @property {string} _seed - the seed used to generate this graph
 * @property {number} _depthCount - number of depths/floors
 */
export default class MapGraph {
  /**
   * @param {MapNode[]} nodes
   * @param {string} seed
   * @param {number} depthCount
   */
  constructor(nodes, seed, depthCount) {
    /** @type {Map<string, MapNode>} */
    this._nodes = new Map();
    for (const node of nodes) {
      this._nodes.set(node.id, node);
    }
    this._seed = seed;
    this._depthCount = depthCount;
  }

  /** The seed that produced this graph */
  get seed() { return this._seed; }

  /** Number of depth columns */
  get depthCount() { return this._depthCount; }

  /** Total number of nodes */
  get size() { return this._nodes.size; }

  /** Iterable of all node ids */
  get nodeIds() { return this._nodes.keys(); }

  /** Array of all MapNode instances */
  get allNodes() { return [...this._nodes.values()]; }

  /**
   * Get a node by id.
   * @param {string} id
   * @returns {MapNode|undefined}
   */
  getNode(id) {
    return this._nodes.get(id);
  }

  /**
   * Get all nodes at a given depth.
   * @param {number} depth
   * @returns {MapNode[]}
   */
  getNodesAtDepth(depth) {
    const result = [];
    for (const node of this._nodes.values()) {
      if (node.depth === depth) result.push(node);
    }
    return result;
  }

  /**
   * Get all nodes at a given depth, sorted by lane.
   * @param {number} depth
   * @returns {MapNode[]}
   */
  getNodesAtDepthSorted(depth) {
    return this.getNodesAtDepth(depth).sort((a, b) => a.lane - b.lane);
  }

  /**
   * Get the boss node (final depth).
   * @returns {MapNode|undefined}
   */
  get bossNode() {
    const lastDepth = this._depthCount - 1;
    const nodes = this.getNodesAtDepth(lastDepth);
    return nodes.find(n => n.type === 'boss') || nodes[0];
  }

  /**
   * Check if a path exists from startId to targetId via outgoing edges.
   * Simple BFS.
   */
  pathExists(fromId, toId) {
    const visited = new Set();
    const queue = [fromId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === toId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const node = this._nodes.get(current);
      if (node) {
        for (const outId of node.outgoing) {
          if (!visited.has(outId)) queue.push(outId);
        }
      }
    }
    return false;
  }

  /**
   * Collect all nodes reachable from startId following outgoing edges.
   * @param {string} startId
   * @returns {Set<string>}
   */
  reachableFrom(startId) {
    const reachable = new Set();
    const stack = [startId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      const node = this._nodes.get(id);
      if (node) {
        for (const outId of node.outgoing) {
          if (!reachable.has(outId)) stack.push(outId);
        }
      }
    }
    return reachable;
  }
}
