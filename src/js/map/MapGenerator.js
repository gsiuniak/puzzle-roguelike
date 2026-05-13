/**
 * SeededRNG — a simple, deterministic pseudo-random number generator.
 *
 * Uses the mulberry32 algorithm. Same seed always produces the same sequence.
 * This is kept isolated from the rest of the game to ensure map generation
 * is 100% deterministic and independent of any other randomness sources.
 */
export class SeededRNG {
  /**
   * @param {number|string} seed
   */
  constructor(seed) {
    if (typeof seed === 'string') {
      // Hash string to a 32-bit integer
      let h = 0;
      for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
      }
      this._state = h >>> 0;
    } else {
      this._state = (seed | 0) >>> 0;
    }
    if (this._state === 0) this._state = 1;
  }

  /**
   * Return a float in [0, 1).
   */
  next() {
    let t = this._state;
    t ^= t << 13;
    t ^= t >> 17;
    t ^= t << 5;
    t = t >>> 0;
    this._state = t;
    return (t >>> 0) / 4294967296;
  }

  /**
   * Return an integer in [min, max] (inclusive).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  intRange(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Pick a random element from an array.
   * @template T
   * @param {T[]} arr
   * @returns {T}
   */
  pick(arr) {
    return arr[this.intRange(0, arr.length - 1)];
  }

  /**
   * Shuffle an array in-place (Fisher-Yates).
   * @template T
   * @param {T[]} arr
   * @returns {T[]}
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.intRange(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/**
 * MapGenerator — procedurally generates a MapGraph from a seed.
 *
 * Generation rules:
 *   - 10 depths (0–9), left → right
 *   - Depth 0 = starting battle (exactly 1 node)
 *   - Depth 9 = boss (exactly 1 node)
 *   - Depths 1–8: 2–4 nodes per depth
 *   - Every node on depth N connects to ≥1 node on depth N+1
 *   - Every node on depth N+1 has ≥1 incoming from depth N
 *   - No dead ends: every route reaches the boss
 *   - Elite: not before depth 4; not consecutive on same path
 *   - Rest:  not before depth 3; not consecutive on same path
 *   - Chest: usually on optional branches
 *   - Boss: exactly 1 at final depth
 *
 * Public API:
 *   static generate(seed, [opts]) → MapGraph
 */
import MapNode from './MapNode.js';
import MapGraph from './MapGraph.js';

/** @type {{min:number,max:number}} */
const NODES_PER_DEPTH = { min: 2, max: 4 };
const DEPTH_COUNT = 10;

const NODE_TYPES = {
  BATTLE:   'battle',
  ELITE:    'elite',
  CHEST:    'chest',
  TRAINING: 'training',
  REST:     'rest',
  BOSS:     'boss',
};

export default class MapGenerator {
  /**
   * Generate a full map graph from a seed.
   *
   * @param {string|number} seed
   * @param {object} [opts]
   * @param {number} [opts.depthCount=10]
   * @param {{min:number,max:number}} [opts.nodesPerDepth]
   * @returns {MapGraph}
   */
  static generate(seed, opts = {}) {
    const rng = new SeededRNG(seed);
    const depthCount = opts.depthCount || DEPTH_COUNT;
    const nRange = opts.nodesPerDepth || NODES_PER_DEPTH;

    /** @type {MapNode[]} */
    const allNodes = [];

    /** @type {Map<number, MapNode[]>} depth → nodes */
    const depthNodes = new Map();

    // ── 1. Create nodes per depth ───────────────────────
    for (let d = 0; d < depthCount; d++) {
      const nodes = [];
      if (d === 0) {
        // Exactly one starting battle
        const node = new MapNode({
          id: `node_${allNodes.length}`,
          type: NODE_TYPES.BATTLE,
          depth: d,
          lane: 0,
        });
        node.state.discovered = true;
        node.state.reachable = true;
        nodes.push(node);
      } else if (d === depthCount - 1) {
        // Exactly one boss
        const node = new MapNode({
          id: `node_${allNodes.length}`,
          type: NODE_TYPES.BOSS,
          depth: d,
          lane: 0,
        });
        nodes.push(node);
      } else {
        const count = rng.intRange(nRange.min, nRange.max);
        for (let i = 0; i < count; i++) {
          const node = new MapNode({
            id: `node_${allNodes.length + i}`,
            type: NODE_TYPES.BATTLE, // placeholder — assigned below
            depth: d,
            lane: i,
          });
          nodes.push(node);
        }
      }

      depthNodes.set(d, nodes);
      allNodes.push(...nodes);
    }

    // ── 2. Assign node types for non-starting / non-boss depths ──
    MapGenerator._assignTypes(allNodes, depthNodes, depthCount, rng);

    // ── 3. Wire connections ─────────────────────────────
    MapGenerator._wireConnections(depthNodes, depthCount, rng);

    // ── 4. Validate and fix connectivity ────────────────
    MapGenerator._validateConnectivity(depthNodes, depthCount);

    // ── 5. Ensure chest at depth 6 is on at least one start→boss route ─
    MapGenerator._ensureChestRoute(depthNodes, depthCount, rng);

    return new MapGraph(allNodes, String(seed), depthCount);
  }

  /**
   * Assign node types following game rules.
   */
  static _assignTypes(allNodes, depthNodes, depthCount, rng) {
    for (let d = 1; d < depthCount - 1; d++) {
      const nodes = depthNodes.get(d);
      if (!nodes || nodes.length === 0) continue;

      const count = nodes.length;

      // ── Depth 6: ALL nodes are chests ──────────────────
      // This guarantees ≥2 chests AND every start→boss path
      // must pass through at least one chest — no path can
      // avert going to a chest.
      if (d === 6) {
        for (let i = 0; i < nodes.length; i++) {
          nodes[i].type = NODE_TYPES.CHEST;
          nodes[i].meta.forcedChest = true;
        }
        continue;
      }

      // Determine elite eligibility (not before depth 4)
      const eliteOk = d >= 4;

      // Determine rest eligibility (not before depth 3)
      const restOk = d >= 3;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        // Roll for special type
        const roll = rng.next();

        if (eliteOk && roll < 0.10) {
          // 10% chance for elite (if eligible)
          node.type = NODE_TYPES.ELITE;
          node.meta.eliteRoll = roll;
        } else if (restOk && roll < 0.22) {
          // ~12% chance for rest (if eligible, cumulative above elite)
          node.type = NODE_TYPES.REST;
        } else if (roll < 0.44) {
          // ~22% chance for training (after elite/rest thresholds)
          node.type = NODE_TYPES.TRAINING;
        } else {
          node.type = NODE_TYPES.BATTLE;
        }

        // If depth has only 1 node, force it to be battle or rest
        if (count === 1 && (node.type === NODE_TYPES.TRAINING)) {
          node.type = NODE_TYPES.BATTLE;
        }
      }
    }
  }

  /**
   * Wire edges between consecutive depths.
   * Ensures every node has at least one incoming and one outgoing.
   */
  static _wireConnections(depthNodes, depthCount, rng) {
    for (let d = 0; d < depthCount - 1; d++) {
      const current = depthNodes.get(d) || [];
      const next = depthNodes.get(d + 1) || [];

      if (current.length === 0 || next.length === 0) continue;

      // Each node at depth d must have at least one outgoing
      // Each node at depth d+1 must have at least one incoming

      // ── Assign edges ──────────────────────────────
      if (current.length === 1 && next.length === 1) {
        // Trivial: single → single
        current[0].outgoing.push(next[0].id);
        next[0].incoming.push(current[0].id);
      } else if (current.length === 1) {
        // One current → all next (fan out)
        for (const nextNode of next) {
          current[0].outgoing.push(nextNode.id);
          nextNode.incoming.push(current[0].id);
        }
      } else if (next.length === 1) {
        // All current → one next (fan in)
        for (const currNode of current) {
          currNode.outgoing.push(next[0].id);
          next[0].incoming.push(currNode.id);
        }
      } else {
        // General case: multiple → multiple
        // Strategy: connect adjacent lanes, with some diagonal connections

        // Step 1: Ensure minimum connectivity — every next node gets at least one incoming
        const currLanes = current.map((_, i) => i);
        rng.shuffle(currLanes);

        for (let ni = 0; ni < next.length; ni++) {
          // Pick a primary parent (prefer closest lane)
          const laneFraction = ni / Math.max(1, next.length - 1);
          const targetLane = Math.round(laneFraction * (current.length - 1));
          const primaryIdx = Math.max(0, Math.min(current.length - 1, targetLane));

          const primary = current[primaryIdx];
          if (primary && !primary.outgoing.includes(next[ni].id)) {
            primary.outgoing.push(next[ni].id);
            next[ni].incoming.push(primary.id);
          }
        }

        // Step 2: Ensure every current node has at least one outgoing
        for (const currNode of current) {
          if (currNode.outgoing.length === 0) {
            // Connect to a random next node
            const target = rng.pick(next);
            currNode.outgoing.push(target.id);
            target.incoming.push(currNode.id);
          }
        }

        // Step 3: Add some extra diagonal connections for branching
        for (let ci = 0; ci < current.length; ci++) {
          for (let ni = 0; ni < next.length; ni++) {
            // Already connected
            if (current[ci].outgoing.includes(next[ni].id)) continue;

            // Add extra edges with probability based on lane distance
            const dist = Math.abs(ci / Math.max(1, current.length - 1) - ni / Math.max(1, next.length - 1));
            const prob = dist < 0.3 ? 0.6 : dist < 0.6 ? 0.3 : 0.05;

            if (rng.next() < prob) {
              current[ci].outgoing.push(next[ni].id);
              next[ni].incoming.push(current[ci].id);
            }
          }
        }
      }
    }

    // ── Elite consecutiveness check ─────────────────
    // If an elite node connects to another elite on the next depth,
    // re-roll the child's type to battle.
    for (let d = 3; d < depthCount - 2; d++) {
      const currNodes = depthNodes.get(d) || [];
      const nextNodes = depthNodes.get(d + 1) || [];

      for (const currNode of currNodes) {
        if (currNode.type !== NODE_TYPES.ELITE) continue;

        for (const outId of currNode.outgoing) {
          const child = nextNodes.find(n => n.id === outId);
          if (child && child.type === NODE_TYPES.ELITE) {
            child.type = NODE_TYPES.BATTLE;
            child.meta.wasElite = true;
          }
        }
      }
    }

    // ── Rest consecutiveness check ──────────────────
    for (let d = 2; d < depthCount - 2; d++) {
      const currNodes = depthNodes.get(d) || [];
      const nextNodes = depthNodes.get(d + 1) || [];

      for (const currNode of currNodes) {
        if (currNode.type !== NODE_TYPES.REST) continue;

        for (const outId of currNode.outgoing) {
          const child = nextNodes.find(n => n.id === outId);
          if (child && child.type === NODE_TYPES.REST) {
            child.type = NODE_TYPES.BATTLE;
            child.meta.wasRest = true;
          }
        }
      }
    }
  }

  /**
   * Ensure every node can reach the boss and the start can reach every node.
   * If any node is disconnected, add emergency edges.
   */
  static _validateConnectivity(depthNodes, depthCount) {
    // Build a temporary lookup
    /** @type {Map<string, MapNode>} */
    const nodeMap = new Map();
    for (const nodes of depthNodes.values()) {
      for (const n of nodes) nodeMap.set(n.id, n);
    }

    const startNode = (depthNodes.get(0) || [])[0];
    const bossNode = (depthNodes.get(depthCount - 1) || [])[0];
    if (!startNode || !bossNode) return;

    // Check: can every node reach the boss?
    for (const [, node] of nodeMap) {
      if (node.id === bossNode.id) continue;
      if (!MapGenerator._canReach(nodeMap, node.id, bossNode.id)) {
        // Emergency: connect this node's depth's last node to boss
        // Actually, connect this node to any node in next depth that can reach boss
        const nextDepth = node.depth + 1;
        const nextNodes = depthNodes.get(nextDepth) || [];
        for (const nn of nextNodes) {
          if (MapGenerator._canReach(nodeMap, nn.id, bossNode.id)) {
            if (!node.outgoing.includes(nn.id)) {
              node.outgoing.push(nn.id);
              nn.incoming.push(node.id);
            }
            break;
          }
        }
      }
    }

    // Check: can start reach every node?
    const reachable = new Set();
    const stack = [startNode.id];
    while (stack.length > 0) {
      const id = stack.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      const node = nodeMap.get(id);
      if (node) {
        for (const outId of node.outgoing) {
          if (!reachable.has(outId)) stack.push(outId);
        }
      }
    }

    // If any node is unreachable from start, connect it
    for (const [, node] of nodeMap) {
      if (!reachable.has(node.id) && node.depth > 0) {
        // Connect from some node in the previous depth
        const prevDepth = node.depth - 1;
        const prevNodes = depthNodes.get(prevDepth) || [];
        if (prevNodes.length > 0) {
          const parent = prevNodes[0];
          if (!parent.outgoing.includes(node.id)) {
            parent.outgoing.push(node.id);
            node.incoming.push(parent.id);
          }
          reachable.add(node.id);
          // Also add all downstream
          const ds = [node.id];
          while (ds.length > 0) {
            const did = ds.pop();
            if (!reachable.has(did)) {
              reachable.add(did);
              const dn = nodeMap.get(did);
              if (dn) {
                for (const oid of dn.outgoing) {
                  if (!reachable.has(oid)) ds.push(oid);
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Verify that every valid start→boss route passes through a chest at depth 6.
   *
   * Since _assignTypes forces ALL depth-6 nodes to be chests, every path
   * automatically satisfies this requirement.  This method acts as a
   * defensive sanity check: if any depth-6 node is *not* a chest (e.g. due
   * to a future refactor), it is forced back to chest.
   */
  static _ensureChestRoute(depthNodes, depthCount, rng) {
    const depth6Nodes = depthNodes.get(6) || [];
    if (depth6Nodes.length === 0) return;

    let chestCount = 0;
    for (const node of depth6Nodes) {
      if (node.type !== NODE_TYPES.CHEST) {
        node.type = NODE_TYPES.CHEST;
        node.meta.forcedChest = true;
      }
      chestCount++;
    }

    // Defensive: if somehow only 1 node exists at depth 6, force at least 2
    // by duplicating isn't possible here, but log a warning for investigation.
    if (chestCount < 2) {
      console.warn(
        `[MapGenerator] Depth 6 has only ${chestCount} chest(s). ` +
        `Expected ≥2. Check nodes-per-depth range.`
      );
    }
  }

  /**
   * BFS: does a path exist from fromId to toId?
   */
  static _canReach(nodeMap, fromId, toId) {
    const visited = new Set();
    const queue = [fromId];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === toId) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodeMap.get(id);
      if (node) {
        for (const outId of node.outgoing) {
          if (!visited.has(outId)) queue.push(outId);
        }
      }
    }
    return false;
  }
}
