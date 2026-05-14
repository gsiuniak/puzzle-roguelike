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
 *   - Depths 1–8: 2–4 nodes per depth, smoothed (±1 node change
 *     between consecutive depths to support local-lane routing)
 *   - Every node on depth N connects to ≥1 node on depth N+1
 *   - Every node on depth N+1 has ≥1 incoming from depth N
 *   - No dead ends: every route reaches the boss
 *   - **Local-lane constraint:** connections between consecutive
 *     depths may only move vertically by at most 1 lane
 *     (|source.lane − target.lane| ≤ 1), preventing chaotic
 *     crisscrossing paths
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
    //
    // Smoothing rule: consecutive depths differ by at most 1 node.
    // This ensures every node can find a valid connection target
    // within ±1 lane at the next depth (no stranded nodes).
    let prevCount = 1; // depth 0 has exactly 1 start node

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
        prevCount = 1;
      } else if (d === depthCount - 1) {
        // Exactly one boss
        const node = new MapNode({
          id: `node_${allNodes.length}`,
          type: NODE_TYPES.BOSS,
          depth: d,
          lane: 0,
        });
        nodes.push(node);
      } else if (d === 1) {
        // Depth 1: fan-out from the single start node (depth 0, lane 0).
        // With ±1 lane constraint, start can only reach lanes 0 and 1,
        // so depth 1 is capped at 2 nodes.
        const count = 2; // min=2 from config, max=2 for valid fan-out
        for (let i = 0; i < count; i++) {
          const node = new MapNode({
            id: `node_${allNodes.length + i}`,
            type: NODE_TYPES.BATTLE, // placeholder — assigned below
            depth: d,
            lane: i,
          });
          nodes.push(node);
        }
        prevCount = count;
      } else if (d === depthCount - 2) {
        // Pre-boss depth: must converge to boss (depth 9, lane 0).
        // Only lanes 0 and 1 can reach boss lane 0 (±1 constraint),
        // so this depth is capped at 2 nodes.
        const minC = Math.max(nRange.min, prevCount - 1);
        const maxC = Math.min(2, prevCount + 1, nRange.max);
        const count = rng.intRange(minC, Math.max(minC, maxC));
        for (let i = 0; i < count; i++) {
          const node = new MapNode({
            id: `node_${allNodes.length + i}`,
            type: NODE_TYPES.BATTLE, // placeholder — assigned below
            depth: d,
            lane: i,
          });
          nodes.push(node);
        }
        prevCount = count;
      } else if (d === depthCount - 3) {
        // Third-to-last depth: prepare smooth convergence to boss.
        // Cap at 3 nodes so the next depth can be 2 and then boss is 1,
        // all within ±1 lane differences.
        const minC = Math.max(nRange.min, prevCount - 1);
        const maxC = Math.min(3, prevCount + 1, nRange.max);
        const count = rng.intRange(minC, Math.max(minC, maxC));
        for (let i = 0; i < count; i++) {
          const node = new MapNode({
            id: `node_${allNodes.length + i}`,
            type: NODE_TYPES.BATTLE, // placeholder — assigned below
            depth: d,
            lane: i,
          });
          nodes.push(node);
        }
        prevCount = count;
      } else {
        // Normal depth: smoothed node count (diff ≤ 1 from previous)
        const minC = Math.max(nRange.min, prevCount - 1);
        const maxC = Math.min(nRange.max, prevCount + 1);
        const count = rng.intRange(minC, maxC);
        for (let i = 0; i < count; i++) {
          const node = new MapNode({
            id: `node_${allNodes.length + i}`,
            type: NODE_TYPES.BATTLE, // placeholder — assigned below
            depth: d,
            lane: i,
          });
          nodes.push(node);
        }
        prevCount = count;
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

    // ── 4b. Validate edge lane constraints ───────────
    MapGenerator._validateEdgeConstraints(depthNodes, depthCount);

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
   * Wire edges between consecutive depths with strict local-lane constraint.
   *
   * CONSTRAINT: A connection may only move vertically by at most 1 lane.
   *              |source.lane − target.lane| ≤ 1
   *
   * This prevents long crisscrossing paths, chaotic intersections, and
   * visually confusing route jumps.  Combined with the smoothed node-count
   * constraint in generate(), every node is guaranteed to have at least one
   * valid neighbour at the adjacent depth within the ±1 lane window.
   */
  static _wireConnections(depthNodes, depthCount, rng) {
    for (let d = 0; d < depthCount - 1; d++) {
      const current = depthNodes.get(d) || [];
      const next = depthNodes.get(d + 1) || [];

      if (current.length === 0 || next.length === 0) continue;

      // ── Assign edges (all paths enforce |lane diff| ≤ 1) ──
      if (current.length === 1 && next.length === 1) {
        // Trivial: single → single (lane diff already validated by smoothing)
        current[0].outgoing.push(next[0].id);
        next[0].incoming.push(current[0].id);

      } else if (current.length === 1) {
        // Fan-out from a single source (e.g. start node → depth 1).
        // Only connect to next nodes whose lane is within ±1 of the source.
        const srcLane = current[0].lane;
        for (const nextNode of next) {
          if (Math.abs(srcLane - nextNode.lane) <= 1) {
            current[0].outgoing.push(nextNode.id);
            nextNode.incoming.push(current[0].id);
          }
        }

      } else if (next.length === 1) {
        // Fan-in to a single target (e.g. pre-boss depth → boss).
        // Only current nodes within ±1 lane of the target can connect.
        const tgtLane = next[0].lane;
        for (const currNode of current) {
          if (Math.abs(currNode.lane - tgtLane) <= 1) {
            currNode.outgoing.push(next[0].id);
            next[0].incoming.push(currNode.id);
          }
        }

      } else {
        // ── General case: multiple → multiple ──────────────
        // All connections enforce |source.lane − target.lane| ≤ 1.

        // Step 1: Ensure every NEXT node has at least one incoming
        //         from a valid (±1 lane) current node.
        const shuffledCurrent = [...current];
        rng.shuffle(shuffledCurrent);

        for (const nextNode of next) {
          if (nextNode.incoming.length > 0) continue; // already has a parent

          // Prefer same-lane, then adjacent lanes
          let best = null;
          let bestDist = Infinity;
          for (const cand of shuffledCurrent) {
            const diff = Math.abs(cand.lane - nextNode.lane);
            if (diff <= 1 && diff < bestDist) {
              bestDist = diff;
              best = cand;
              if (diff === 0) break; // perfect match — stop early
            }
          }

          if (best) {
            best.outgoing.push(nextNode.id);
            nextNode.incoming.push(best.id);
          }
          // If no valid parent found, the node-count smoothing guarantee
          // ensures this cannot happen under normal generation.
        }

        // Step 2: Ensure every CURRENT node has at least one outgoing
        //         to a valid (±1 lane) next node.
        for (const currNode of current) {
          if (currNode.outgoing.length > 0) continue; // already has a child

          let best = null;
          let bestDist = Infinity;
          for (const cand of next) {
            const diff = Math.abs(currNode.lane - cand.lane);
            if (diff <= 1 && diff < bestDist) {
              bestDist = diff;
              best = cand;
              if (diff === 0) break;
            }
          }

          if (best) {
            currNode.outgoing.push(best.id);
            best.incoming.push(currNode.id);
          }
        }

        // Step 3: Add extra local connections for branching / convergence.
        //         Only edges within ±1 lane are considered.
        for (let ci = 0; ci < current.length; ci++) {
          const currNode = current[ci];
          for (let ni = 0; ni < next.length; ni++) {
            const nextNode = next[ni];
            // Already connected
            if (currNode.outgoing.includes(nextNode.id)) continue;

            const laneDiff = Math.abs(currNode.lane - nextNode.lane);
            // Hard constraint: never allow a jump > 1 lane
            if (laneDiff > 1) continue;

            // Probability based on lane proximity
            //   same lane:    70% chance → encourages straight paths
            //   adjacent lane: 50% chance → balanced branching
            const prob = laneDiff === 0 ? 0.70 : 0.50;

            if (rng.next() < prob) {
              currNode.outgoing.push(nextNode.id);
              nextNode.incoming.push(currNode.id);
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
   * Validate that every generated edge satisfies local-lane constraints:
   *   - source.depth + 1 === target.depth
   *   - |source.lane − target.lane| ≤ 1
   *
   * If an invalid edge is found it is removed and a warning is logged.
   * The connectivity validator (_validateConnectivity) runs *before* this
   * check, so any severed connections will have already been repaired.
   */
  static _validateEdgeConstraints(depthNodes, depthCount) {
    // Build lookup
    const nodeMap = new Map();
    for (const nodes of depthNodes.values()) {
      for (const n of nodes) nodeMap.set(n.id, n);
    }

    let violations = 0;

    for (const [, source] of nodeMap) {
      const validOut = [];
      for (const outId of source.outgoing) {
        const target = nodeMap.get(outId);
        if (!target) continue;

        const depthOk = source.depth + 1 === target.depth;
        const laneOk = Math.abs(source.lane - target.lane) <= 1;

        if (depthOk && laneOk) {
          validOut.push(outId);
        } else {
          violations++;
          console.warn(
            `[MapGenerator] Invalid edge removed: ` +
            `${source.id} (depth ${source.depth}, lane ${source.lane}) → ` +
            `${target.id} (depth ${target.depth}, lane ${target.lane}) | ` +
            `depth diff=${target.depth - source.depth}, lane diff=${Math.abs(source.lane - target.lane)}`
          );
          // Remove from target's incoming as well
          target.incoming = target.incoming.filter(id => id !== source.id);
        }
      }
      source.outgoing = validOut;
    }

    if (violations > 0) {
      console.warn(
        `[MapGenerator] Removed ${violations} edge(s) that violated ` +
        `local-lane constraints (|Δlane| > 1 or non-consecutive depth).`
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
