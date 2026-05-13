/**
 * MapNode — a single vertex in the map graph.
 *
 * Pure data. No rendering, no traversal logic, no gameplay coupling.
 *
 * @property {string} id       - unique identifier ("node_0")
 * @property {string} type     - node type: battle|elite|chest|training|rest|boss
 * @property {number} depth    - floor/depth index (0-based)
 * @property {number} lane     - vertical lane within depth
 * @property {number} x        - layout x (computed by renderer)
 * @property {number} y        - layout y (computed by renderer)
 * @property {string[]} incoming - ids of nodes that lead into this one
 * @property {string[]} outgoing - ids of nodes this one leads to
 * @property {object} state
 * @property {object} [meta]   - optional generator metadata
 */
export default class MapNode {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.type
   * @param {number} opts.depth
   * @param {number} opts.lane
   */
  constructor(opts) {
    this.id = opts.id;
    this.type = opts.type;
    this.depth = opts.depth;
    this.lane = opts.lane;

    /** Layout position — assigned by MapRenderer.layoutNodes() */
    this.x = 0;
    this.y = 0;

    /** @type {string[]} */
    this.incoming = opts.incoming || [];
    /** @type {string[]} */
    this.outgoing = opts.outgoing || [];

    /** Traversal state — managed by MapTraversalController */
    this.state = {
      discovered: false,   // player has seen this node
      reachable: false,    // player can currently travel to this node
      completed: false,    // player has cleared this node
      current: false,      // player is currently at this node
    };

    /** Optional metadata attached during generation */
    this.meta = opts.meta || {};
  }
}
