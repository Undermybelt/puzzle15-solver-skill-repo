// ==UserScript==
// @name         华容道自动求解器
// @namespace    https://sub.hdd.sb/
// @version      1.0.5
// @description  15-puzzle AI — IDA* 最优路径求解
// @match        https://sub.hdd.sb/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const LOG = (...args) => console.log('[puzzle15-solver]', ...args);
  const SCRIPT_NS = 'p15-solver';
  const PAGE_POLL_MS = 1000;
  const LOCK_KEY = 'subhdd:puzzle15:active-session';
  const PAGE_ID_KEY = `${SCRIPT_NS}:page-id`;
  const BOUND_SESSION_KEY = `${SCRIPT_NS}:bound-session`;
  const LOCKS_KEY = `${SCRIPT_NS}:session-locks`;
  const LOCK_HEARTBEAT_MS = 15000;
  const LOCK_STALE_MS = 120000;


  const PANEL_PAGE_KEY = `${SCRIPT_NS}:panel-page`;
  const PANEL_HIDDEN_KEY = `${SCRIPT_NS}:panel-hidden`;
  const PAGE_KIND_HUB = 'hub';
  const PAGE_KIND_GAME = 'game';

  function getPageKind() {
    const path = location.pathname.toLowerCase();
    if (path.includes('/custom/hub-entry')) return PAGE_KIND_HUB;
    return PAGE_KIND_GAME;
  }

  function readPanelPageKind() {
    const store = getSessionStore();
    return store ? (store.getItem(PANEL_PAGE_KEY) || '') : '';
  }

  function writePanelPageKind(kind) {
    const store = getSessionStore();
    if (store) store.setItem(PANEL_PAGE_KEY, kind);
  }

  function isPanelHidden() {
    const store = getSessionStore();
    return store ? store.getItem(PANEL_HIDDEN_KEY) === '1' : false;
  }

  function setPanelHidden(hidden) {
    const store = getSessionStore();
    if (!store) return;
    if (hidden) store.setItem(PANEL_HIDDEN_KEY, '1');
    else store.removeItem(PANEL_HIDDEN_KEY);
  }

  function restorePanelVisibility(panel) {
    if (!panel) return;
    panel.style.display = isPanelHidden() ? 'none' : '';
  }


  function getSessionStore() {
    try { return window.sessionStorage; } catch { return null; }
  }

  function getLocalStore() {
    try { return window.localStorage; } catch { return null; }
  }

  function createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getPageInstanceId() {
    const store = getSessionStore();
    if (!store) return `mem-${createId()}`;
    let pageId = store.getItem(PAGE_ID_KEY);
    if (!pageId) {
      pageId = createId();
      store.setItem(PAGE_ID_KEY, pageId);
    }
    return pageId;
  }

  const PAGE_INSTANCE_ID = getPageInstanceId();

  function getBoundSessionId() {
    const store = getSessionStore();
    return store ? (store.getItem(BOUND_SESSION_KEY) || '') : '';
  }

  function setBoundSessionId(sessionId) {
    const store = getSessionStore();
    if (store) store.setItem(BOUND_SESSION_KEY, String(sessionId));
  }

  function clearBoundSessionId() {
    const store = getSessionStore();
    if (store) store.removeItem(BOUND_SESSION_KEY);
  }

  function readLocks() {
    const store = getLocalStore();
    if (!store) return {};
    try {
      const parsed = JSON.parse(store.getItem(LOCKS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeLocks(locks) {
    const store = getLocalStore();
    if (!store) return;
    store.setItem(LOCKS_KEY, JSON.stringify(locks));
  }

  function cleanupLocks(locks) {
    const now = Date.now();
    for (const [sessionId, meta] of Object.entries(locks)) {
      if (!meta || now - Number(meta.ts || 0) > LOCK_STALE_MS) delete locks[sessionId];
    }
    return locks;
  }

  function getLockOwner(sessionId) {
    if (!sessionId) return null;
    const locks = cleanupLocks(readLocks());
    writeLocks(locks);
    return locks[String(sessionId)] || null;
  }

  function claimSessionLock(sessionId) {
    if (!sessionId) return true;
    const key = String(sessionId);
    const locks = cleanupLocks(readLocks());
    const owner = locks[key];
    if (owner && owner.pageId !== PAGE_INSTANCE_ID) return false;
    locks[key] = { pageId: PAGE_INSTANCE_ID, ts: Date.now() };
    writeLocks(locks);
    setBoundSessionId(key);
    return true;
  }

  function releaseSessionLock(sessionId) {
    if (!sessionId) return;
    const key = String(sessionId);
    const locks = cleanupLocks(readLocks());
    if (locks[key]?.pageId === PAGE_INSTANCE_ID) {
      delete locks[key];
      writeLocks(locks);
    }
  }

  function clearSessionBinding(options = {}) {
    const boundId = options.sessionId ? String(options.sessionId) : (state?.sessionId ? String(state.sessionId) : getBoundSessionId());
    if (boundId) releaseSessionLock(boundId);
    clearBoundSessionId();
  }

  function ensureSessionOwnership(sessionId, reason) {
    const key = String(sessionId || '');
    if (!key) return false;
    if (claimSessionLock(key)) return true;
    const owner = getLockOwner(key);
    const msg = `${reason}: session ${key.slice(0, 8)} 已被另一页面锁定`;
    log(msg);
    showToast('当前华容道已被另一页面锁定', 'warn');
    $info.textContent = msg;
    setProgress('locked');
    LOG('lock owner', owner);
    return false;
  }

  function makeBackgroundSleep() {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      return (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    }
    const source = `
      const timers = new Map();
      self.onmessage = (event) => {
        const { id, ms } = event.data || {};
        const handle = setTimeout(() => {
          timers.delete(id);
          self.postMessage({ id });
        }, Math.max(0, ms || 0));
        timers.set(id, handle);
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'application/javascript' })));
    let seq = 0;
    const pending = new Map();
    worker.onmessage = (event) => {
      const id = event.data?.id;
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      resolve();
    };
    return (ms) => new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      worker.postMessage({ id, ms });
    });
  }

  const sleep = makeBackgroundSleep();

  // ═══════════════════════════════════════════════════════════════
  //  SOLVER MODULE (IDA*)
  // ═══════════════════════════════════════════════════════════════
  const Puzzle15Solver = (() => {
    const DIRECTION_ORDER = ['up', 'down', 'left', 'right'];
    const MOVE_VECTORS = {
      up: { dr: -1, dc: 0 },
      down: { dr: 1, dc: 0 },
      left: { dr: 0, dc: -1 },
      right: { dr: 0, dc: 1 },
    };
    const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const GOAL_CACHE = new Map();
    const GOAL_POS_CACHE = new Map();
    const NEIGHBOR_CACHE = new Map();
    const MANHATTAN_TABLE_CACHE = new Map();
    const SOLVER_LIMITS = {
      3: { exactMs: 18000, exactDepth: 50, weightedMs: 1200, weight: 1.08, queueCap: 16000, seenCap: 80000, beamMs: 1200, beamWidth: 3000 },
      4: { exactMs: 65000, exactDepth: 100, weightedMs: 9000, weight: 1.22, queueCap: 70000, seenCap: 320000, beamMs: 7000, beamWidth: 14000 },
      5: { exactMs: 0, exactDepth: 0, weightedMs: 14000, weight: 1.65, queueCap: 140000, seenCap: 520000, beamMs: 12000, beamWidth: 22000 },
    };

    function flatten(board) {
      const flat = [];
      for (const row of board) for (const v of row) flat.push(v);
      return flat;
    }

    function cloneBoard(board) {
      return board.map((row) => row.slice());
    }

    function goalFlat(size) {
      if (!GOAL_CACHE.has(size)) {
        const out = [];
        for (let i = 1; i < size * size; i++) out.push(i);
        out.push(0);
        GOAL_CACHE.set(size, out);
      }
      return GOAL_CACHE.get(size);
    }

    function goalKey(size) {
      return goalFlat(size).join(',');
    }

    function goalPositions(size) {
      if (!GOAL_POS_CACHE.has(size)) {
        const total = size * size;
        const out = new Int16Array(total * 2);
        for (let tile = 1; tile < total; tile++) {
          out[tile * 2] = Math.floor((tile - 1) / size);
          out[(tile * 2) + 1] = (tile - 1) % size;
        }
        GOAL_POS_CACHE.set(size, out);
      }
      return GOAL_POS_CACHE.get(size);
    }

    function moveTable(size) {
      if (!NEIGHBOR_CACHE.has(size)) {
        const out = [];
        for (let idx = 0; idx < size * size; idx++) {
          const row = Math.floor(idx / size);
          const col = idx % size;
          const moves = [];
          for (const dir of DIRECTION_ORDER) {
            const move = MOVE_VECTORS[dir];
            const nr = row + move.dr;
            const nc = col + move.dc;
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
            moves.push({ dir, index: (nr * size) + nc });
          }
          out[idx] = moves;
        }
        NEIGHBOR_CACHE.set(size, out);
      }
      return NEIGHBOR_CACHE.get(size);
    }

    function manhattanTable(size) {
      if (!MANHATTAN_TABLE_CACHE.has(size)) {
        const total = size * size;
        const table = new Uint16Array(total * total);
        for (let tile = 1; tile < total; tile++) {
          const goalR = Math.floor((tile - 1) / size);
          const goalC = (tile - 1) % size;
          const offset = tile * total;
          for (let pos = 0; pos < total; pos++) {
            const row = Math.floor(pos / size);
            const col = pos % size;
            table[offset + pos] = Math.abs(row - goalR) + Math.abs(col - goalC);
          }
        }
        MANHATTAN_TABLE_CACHE.set(size, table);
      }
      return MANHATTAN_TABLE_CACHE.get(size);
    }

    function boardKey(flat) {
      return Array.from(flat).join(',');
    }

    function isGoalFlat(flat) {
      for (let i = 0; i < flat.length - 1; i++) {
        if (flat[i] !== i + 1) return false;
      }
      return flat[flat.length - 1] === 0;
    }

    function manhattan(flat, size) {
      const total = size * size;
      const table = manhattanTable(size);
      let dist = 0;
      for (let pos = 0; pos < flat.length; pos++) {
        const tile = flat[pos];
        if (tile) dist += table[(tile * total) + pos];
      }
      return dist;
    }

    function linearConflict(flat, size) {
      let conflicts = 0;
      for (let row = 0; row < size; row++) {
        for (let c1 = 0; c1 < size; c1++) {
          const v1 = flat[row * size + c1];
          if (!v1) continue;
          const goalRow1 = Math.floor((v1 - 1) / size);
          const goalCol1 = (v1 - 1) % size;
          if (goalRow1 !== row) continue;
          for (let c2 = c1 + 1; c2 < size; c2++) {
            const v2 = flat[row * size + c2];
            if (!v2) continue;
            const goalRow2 = Math.floor((v2 - 1) / size);
            const goalCol2 = (v2 - 1) % size;
            if (goalRow2 === row && goalCol1 > goalCol2) conflicts++;
          }
        }
      }
      for (let col = 0; col < size; col++) {
        for (let r1 = 0; r1 < size; r1++) {
          const v1 = flat[r1 * size + col];
          if (!v1) continue;
          const goalRow1 = Math.floor((v1 - 1) / size);
          const goalCol1 = (v1 - 1) % size;
          if (goalCol1 !== col) continue;
          for (let r2 = r1 + 1; r2 < size; r2++) {
            const v2 = flat[r2 * size + col];
            if (!v2) continue;
            const goalRow2 = Math.floor((v2 - 1) / size);
            const goalCol2 = (v2 - 1) % size;
            if (goalCol2 === col && goalRow1 > goalRow2) conflicts++;
          }
        }
      }
      return conflicts * 2;
    }

    function cornerConflict(flat, size) {
      if (size < 4) return 0;
      let penalty = 0;
      const last = size * size - 1;
      if (flat[0] !== 1 && (flat[1] === 1 || flat[size] === 1)) penalty += 2;
      if (flat[size - 1] !== size && (flat[size - 2] === size || flat[(size * 2) - 1] === size)) penalty += 2;
      const bottomLeft = size * (size - 1);
      const bottomRight = last;
      const bottomLeftGoal = bottomLeft + 1;
      if (flat[bottomLeft] !== bottomLeftGoal && (flat[bottomLeft + 1] === bottomLeftGoal || flat[bottomLeft - size] === bottomLeftGoal)) penalty += 2;
      if (flat[bottomRight - 1] !== last && (flat[bottomRight - 2] === last || flat[bottomRight - 1 - size] === last)) penalty += 2;
      return penalty;
    }

    function heuristic(flat, size, baseManhattan) {
      const md = Number.isFinite(baseManhattan) ? baseManhattan : manhattan(flat, size);
      return md + linearConflict(flat, size) + cornerConflict(flat, size);
    }

    function isSolvable(flat, size) {
      let inversions = 0;
      for (let i = 0; i < flat.length; i++) {
        for (let j = i + 1; j < flat.length; j++) {
          if (flat[i] && flat[j] && flat[i] > flat[j]) inversions++;
        }
      }
      if (size % 2 === 1) return inversions % 2 === 0;
      const blankRow = Math.floor(flat.indexOf(0) / size);
      const fromBottom = size - blankRow;
      return (inversions + fromBottom) % 2 === 1;
    }

    function applyMoveFlat(flat, size, blankIdx, dir) {
      const move = MOVE_VECTORS[dir];
      const br = Math.floor(blankIdx / size);
      const bc = blankIdx % size;
      const nr = br + move.dr;
      const nc = bc + move.dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) return null;
      const nIdx = nr * size + nc;
      const next = flat.slice();
      next[blankIdx] = next[nIdx];
      next[nIdx] = 0;
      return { flat: next, blankIdx: nIdx, movedTile: flat[nIdx] };
    }

    function reconstructMoves(parents, key, startKey) {
      const out = [];
      let curKey = key;
      while (curKey !== startKey) {
        const entry = parents.get(curKey);
        if (!entry) return null;
        out.push(entry.move);
        curKey = entry.parent;
      }
      out.reverse();
      return out;
    }

    class MinHeap {
      constructor(compare) {
        this.compare = compare;
        this.data = [];
      }

      get size() {
        return this.data.length;
      }

      push(item) {
        const data = this.data;
        data.push(item);
        let idx = data.length - 1;
        while (idx > 0) {
          const parent = (idx - 1) >> 1;
          if (this.compare(data[idx], data[parent]) >= 0) break;
          [data[idx], data[parent]] = [data[parent], data[idx]];
          idx = parent;
        }
      }

      pop() {
        const data = this.data;
        if (!data.length) return null;
        const top = data[0];
        const last = data.pop();
        if (data.length) {
          data[0] = last;
          let idx = 0;
          while (true) {
            const left = (idx * 2) + 1;
            const right = left + 1;
            let best = idx;
            if (left < data.length && this.compare(data[left], data[best]) < 0) best = left;
            if (right < data.length && this.compare(data[right], data[best]) < 0) best = right;
            if (best === idx) break;
            [data[idx], data[best]] = [data[best], data[idx]];
            idx = best;
          }
        }
        return top;
      }
    }

    function exactSolve(board, size, timeBudgetMs, depthLimit) {
      if (!timeBudgetMs || !depthLimit) {
        return { ok: false, reason: 'skipped_exact', sequence: [], stats: { algorithm: 'ida*', timeMs: 0 } };
      }
      const flat = flatten(board);
      if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
      if (isGoalFlat(flat)) return { ok: true, sequence: [], stats: { algorithm: 'ida*', timeMs: 0, iterations: 0, steps: 0 } };

      const total = size * size;
      const table = manhattanTable(size);
      const state = new Uint8Array(flat);
      const neighborMoves = moveTable(size);
      const t0 = Date.now();
      const blankIdx = flat.indexOf(0);
      let threshold = heuristic(state, size);
      let iterations = 0;

      function dfs(g, bound, blankPos, lastDir, path, currentManhattan) {
        if (Date.now() - t0 > timeBudgetMs) return { status: 'timeout' };
        const h = heuristic(state, size, currentManhattan);
        const f = g + h;
        if (f > bound) return { status: 'bound', value: f };
        if (h === 0) return { status: 'found', path: path.slice() };
        if (g >= depthLimit) return { status: 'bound', value: Infinity };

        let nextBound = Infinity;
        const candidates = [];
        for (const move of neighborMoves[blankPos]) {
          if (lastDir && OPPOSITE[move.dir] === lastDir) continue;
          const movedTile = state[move.index];
          const nextManhattan = currentManhattan - table[(movedTile * total) + move.index] + table[(movedTile * total) + blankPos];
          state[blankPos] = movedTile;
          state[move.index] = 0;
          const nextH = heuristic(state, size, nextManhattan);
          state[move.index] = movedTile;
          state[blankPos] = 0;
          candidates.push({ dir: move.dir, index: move.index, movedTile, nextManhattan, score: nextH });
        }
        candidates.sort((a, b) => a.score - b.score || a.movedTile - b.movedTile);

        for (const candidate of candidates) {
          state[blankPos] = candidate.movedTile;
          state[candidate.index] = 0;
          path.push(candidate.dir);
          const result = dfs(g + 1, bound, candidate.index, candidate.dir, path, candidate.nextManhattan);
          path.pop();
          state[candidate.index] = candidate.movedTile;
          state[blankPos] = 0;
          if (result.status === 'found' || result.status === 'timeout') return result;
          if (result.value < nextBound) nextBound = result.value;
        }
        return { status: 'bound', value: nextBound };
      }

      let currentThreshold = threshold;
      let currentManhattan = manhattan(state, size);
      while (iterations < 2000) {
        iterations += 1;
        const result = dfs(0, currentThreshold, blankIdx, null, [], currentManhattan);
        if (result.status === 'found') {
          return { ok: true, sequence: result.path, stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations, steps: result.path.length } };
        }
        if (result.status === 'timeout') {
          return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
        }
        if (!Number.isFinite(result.value)) {
          return { ok: false, reason: 'depth_limit', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
        }
        currentThreshold = result.value;
      }
      return { ok: false, reason: 'max_iterations', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
    }

    function weightedAStarSolve(board, size, options) {
      const flat = flatten(board);
      if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
      if (isGoalFlat(flat)) return { ok: true, sequence: [], stats: { algorithm: 'weighted-a*', timeMs: 0, steps: 0 } };

      const t0 = Date.now();
      const total = size * size;
      const table = manhattanTable(size);
      const neighborMoves = moveTable(size);
      const startKey = boardKey(flat);
      const open = new MinHeap((a, b) => a.f - b.f || a.h - b.h || a.g - b.g);
      const parents = new Map([[startKey, { parent: null, move: null }]]);
      const bestG = new Map([[startKey, 0]]);
      const weight = options.weight || 1.5;
      const queueCap = options.queueCap || 50000;
      const seenCap = options.seenCap || 200000;
      const timeBudgetMs = options.weightedMs || options.beamMs || 4000;

      const startManhattan = manhattan(flat, size);
      const startH = heuristic(flat, size, startManhattan);
      open.push({ flat: new Uint8Array(flat), blankIdx: flat.indexOf(0), g: 0, h: startH, md: startManhattan, f: startH * weight, key: startKey, lastDir: null });

      let expanded = 0;

      while (open.size) {
        if (Date.now() - t0 > timeBudgetMs) {
          return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'weighted-a*', timeMs: Date.now() - t0, expanded, open: open.size } };
        }

        const node = open.pop();
        if (!node) break;
        const bestKnown = bestG.get(node.key);
        if (bestKnown !== node.g) continue;
        if (node.h === 0 || isGoalFlat(node.flat)) {
          const sequence = reconstructMoves(parents, node.key, startKey) || [];
          return { ok: true, sequence: sequence.map((dir) => OPPOSITE[dir]), stats: { algorithm: 'weighted-a*', timeMs: Date.now() - t0, expanded, steps: sequence.length, open: open.size } };
        }

        expanded += 1;
        for (const move of neighborMoves[node.blankIdx]) {
          if (node.lastDir && OPPOSITE[move.dir] === node.lastDir) continue;
          const nextFlat = node.flat.slice();
          const movedTile = nextFlat[move.index];
          nextFlat[node.blankIdx] = movedTile;
          nextFlat[move.index] = 0;
          const nextKey = boardKey(nextFlat);
          const nextG = node.g + 1;
          const prevG = bestG.get(nextKey);
          if (prevG !== undefined && prevG <= nextG) continue;

          const nextManhattan = node.md - table[(movedTile * total) + move.index] + table[(movedTile * total) + node.blankIdx];
          const nextH = heuristic(nextFlat, size, nextManhattan);
          bestG.set(nextKey, nextG);
          parents.set(nextKey, { parent: node.key, move: move.dir });
          open.push({ flat: nextFlat, blankIdx: move.index, g: nextG, h: nextH, md: nextManhattan, f: nextG + (weight * nextH), key: nextKey, lastDir: move.dir });
        }

        if (bestG.size > seenCap) {
          const survivors = new Map();
          const frontier = open.data.slice().sort((a, b) => a.f - b.f || a.h - b.h).slice(0, queueCap);
          for (const item of frontier) survivors.set(item.key, bestG.get(item.key));
          bestG.clear();
          for (const [key, value] of survivors) bestG.set(key, value);
        }

        if (open.size > queueCap * 2) {
          const kept = open.data.slice().sort((a, b) => a.f - b.f || a.h - b.h).slice(0, queueCap);
          open.data = [];
          for (const item of kept) open.push(item);
        }
      }

      return { ok: false, reason: 'exhausted', sequence: [], stats: { algorithm: 'weighted-a*', timeMs: Date.now() - t0, expanded, open: open.size } };
    }

    function beamBidirectionalSolve(board, size, options) {
      const flat = flatten(board);
      if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
      if (isGoalFlat(flat)) return { ok: true, sequence: [], stats: { algorithm: 'beam-bidir', timeMs: 0, steps: 0 } };

      const t0 = Date.now();
      const goal = goalFlat(size);
      const startKey = boardKey(flat);
      const goalStateKey = goalKey(size);
      const beamWidth = options.beamWidth;
      const timeBudgetMs = options.beamMs;

      const startParents = new Map([[startKey, { parent: null, move: null }]]);
      const goalParents = new Map([[goalStateKey, { parent: null, move: null }]]);
      const startSeenDepth = new Map([[startKey, 0]]);
      const goalSeenDepth = new Map([[goalStateKey, 0]]);
      const neighbors = moveTable(size);

      let startFrontier = [{ flat: new Uint8Array(flat), blankIdx: flat.indexOf(0), g: 0, h: heuristic(flat, size), lastDir: null, key: startKey }];
      let goalFrontier = [{ flat: new Uint8Array(goal), blankIdx: goal.indexOf(0), g: 0, h: 0, lastDir: null, key: goalStateKey }];
      let expanded = 0;
      let depth = 0;

      function expand(frontier, seenDepth, parents, otherParents, forward) {
        const next = [];
        let meetKey = null;
        for (const node of frontier) {
          if (Date.now() - t0 > timeBudgetMs) return { timeout: true };
          const candidates = [];
          for (const move of neighbors[node.blankIdx]) {
            if (node.lastDir && OPPOSITE[move.dir] === node.lastDir) continue;
            const nextFlat = node.flat.slice();
            const movedTile = nextFlat[move.index];
            nextFlat[node.blankIdx] = movedTile;
            nextFlat[move.index] = 0;
            const nextKey = boardKey(nextFlat);
            const nextDepth = node.g + 1;
            const prevDepth = seenDepth.get(nextKey);
            if (prevDepth !== undefined && prevDepth <= nextDepth) continue;
            const nextH = heuristic(nextFlat, size);
            const score = (nextDepth * 0.35) + nextH;
            candidates.push({ flat: nextFlat, blankIdx: move.index, g: nextDepth, h: nextH, score, lastDir: move.dir, key: nextKey, move: move.dir });
          }
          candidates.sort((a, b) => a.score - b.score || a.h - b.h);
          for (const child of candidates) {
            seenDepth.set(child.key, child.g);
            parents.set(child.key, { parent: node.key, move: forward ? child.move : OPPOSITE[child.move] });
            if (otherParents.has(child.key)) {
              meetKey = child.key;
              return { meetKey, next };
            }
            next.push(child);
          }
          expanded += 1;
        }
        next.sort((a, b) => a.score - b.score || a.h - b.h);
        if (next.length > beamWidth) next.length = beamWidth;
        return { next };
      }

      while (startFrontier.length && goalFrontier.length) {
        if (Date.now() - t0 > timeBudgetMs) break;
        depth += 1;
        const expandStart = startFrontier.length <= goalFrontier.length;
        const result = expandStart
          ? expand(startFrontier, startSeenDepth, startParents, goalParents, true)
          : expand(goalFrontier, goalSeenDepth, goalParents, startParents, false);
        if (result.timeout) {
          return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth } };
        }
        if (result.meetKey) {
          const left = reconstructMoves(startParents, result.meetKey, startKey);
          const right = reconstructMoves(goalParents, result.meetKey, goalStateKey);
          if (!left || !right) {
            return { ok: false, reason: 'reconstruct_failed', sequence: [], stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth } };
          }
          const rightForward = right.slice().reverse().map((dir) => OPPOSITE[dir]);
          const sequence = left.concat(rightForward).map((dir) => OPPOSITE[dir]);
          return { ok: true, sequence, stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth, steps: sequence.length } };
        }
        if (expandStart) startFrontier = result.next;
        else goalFrontier = result.next;
      }
      return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth } };
    }

    function solve2D(board, size) {
      const limits = SOLVER_LIMITS[size] || SOLVER_LIMITS[4];
      const flat = flatten(board);
      if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
      if (isGoalFlat(flat)) return { ok: true, sequence: [], stats: { algorithm: 'noop', timeMs: 0, steps: 0 } };

      const exact = exactSolve(board, size, limits.exactMs, limits.exactDepth);
      if (exact.ok) return exact;

      const beam = beamBidirectionalSolve(board, size, limits);
      if (beam.ok) return beam;

      const weighted = weightedAStarSolve(board, size, limits);
      if (weighted.ok) return weighted;

      const beamExpanded = beam?.stats?.expanded ?? Number.POSITIVE_INFINITY;
      const weightedExpanded = weighted?.stats?.expanded ?? Number.POSITIVE_INFINITY;
      const beamTime = beam?.stats?.timeMs || 0;
      const weightedTime = weighted?.stats?.timeMs || 0;
      const exactTime = exact?.stats?.timeMs || 0;
      if (size >= 5) {
        if (beam.ok && weighted.ok) return beamExpanded <= weightedExpanded ? beam : weighted;
        return beam.ok ? beam : weighted;
      }
      return Math.max(exactTime, beamTime, weightedTime) === exactTime ? exact : ((beamExpanded <= weightedExpanded) ? beam : weighted);
    }

    function solve(board) {
      return solve2D(board, board.length);
    }

    return {
      flatten,
      cloneBoard,
      solve,
      solve2D,
      exactSolve,
      weightedAStarSolve,
      beamBidirectionalSolve,
      isSolvable,
      manhattan,
      linearConflict,
      heuristic,
    };
  })();

  // ═══════════════════════════════════════════════════════════════
  //  API WRAPPER
  // ═══════════════════════════════════════════════════════════════
  function getToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch { return ''; }
  }


  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch('/puzzle15-api' + path, opts);
    if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
    return resp.json();
  }


  // --- Drag handler ---
  function makeDraggable(panel, handle) {
    let dx = 0, dy = 0, ox = 0, oy = 0, dragging = false;
    const margin = 8;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'LABEL') return;
      dragging = true;
      dx = e.clientX;
      dy = e.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
      panel.style.left = ox + 'px';
      panel.style.top = oy + 'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const nextLeft = Math.min(Math.max(margin, ox + e.clientX - dx), window.innerWidth - panel.offsetWidth - margin);
      const nextTop = Math.min(Math.max(margin, oy + e.clientY - dy), window.innerHeight - panel.offsetHeight - margin);
      panel.style.left = nextLeft + 'px';
      panel.style.top = nextTop + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // ═══════════════════════════════════════════════════════════════
  //  UI PANEL
  // ═══════════════════════════════════════════════════════════════
  let panel = null;
  let $log = null;
  let $info = null;
  let $boardWrap = null;
  let $btnStart = null;
  let $btnSolve = null;
  let $btnAuto = null;
  let $btnStop = null;
  let $progress = null;

  function mountPanel() {
    if (window.top !== window.self) return null;
    if (document.getElementById('p15-solver-panel')) {
      panel = document.getElementById('p15-solver-panel');
      $log = document.getElementById('p15-log');
      $info = document.getElementById('p15-info');
      $boardWrap = document.getElementById('p15-board-wrap');
      $btnStart = document.getElementById('p15-start');
      $btnSolve = document.getElementById('p15-solve');
      $btnAuto = document.getElementById('p15-auto');
      $btnStop = document.getElementById('p15-stop');
      $progress = document.getElementById('p15-progress');
      restorePanelVisibility(panel);
      writePanelPageKind(getPageKind());
      return panel;
    }
    panel = document.createElement('div');
    panel.id = 'p15-solver-panel';
    writePanelPageKind(getPageKind());
    panel.innerHTML = `
    <style>
      #p15-solver-panel{position:fixed;right:12px;top:12px;bottom:auto;left:auto;z-index:2147483647;background:rgba(30,30,46,.96);color:#cdd6f4;border:1px solid #45475a;border-radius:10px;font-family:monospace;font-size:13px;width:min(360px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);box-shadow:0 8px 28px rgba(0,0,0,.5);overflow:hidden}
      #p15-solver-panel *{box-sizing:border-box}
      .p15-hdr{background:#313244;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;cursor:move}
      .p15-hdr span{font-weight:bold;font-size:14px}
      .p15-body{padding:10px 12px;max-height:calc(100vh - 72px);overflow:auto}
      .p15-btns{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
      .p15-btns button{background:#89b4fa;color:#1e1e2e;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;flex:1;min-width:70px}
      .p15-btns button:hover{background:#74c7ec}
      .p15-btns button:disabled{opacity:.4;cursor:not-allowed}
      #p15-board-wrap{margin:6px 0;position:relative}
      .p15s-board{display:inline-grid;gap:2px;margin:6px 0;background:#181825;padding:4px;border-radius:4px;position:static;inset:auto}
      .p15s-cell{width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:#313244;border-radius:3px;font-weight:bold;font-size:14px}
      .p15s-cell.empty{background:#1e1e2e}
      .p15-log{background:#11111b;border:1px solid #313244;border-radius:4px;padding:6px;min-height:96px;max-height:180px;overflow-y:auto;font-size:11px;margin-top:6px;white-space:pre-wrap;word-break:break-all}
      .p15-info{font-size:12px;color:#f9e2af;margin-bottom:6px;font-weight:700}
      .p15-status{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;background:#181825;border:1px solid #313244;border-radius:6px;padding:6px 8px;margin:6px 0}
      .p15-progress{font-size:11px;color:#89b4fa;text-align:right}
      #p15-live-badge{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:rgba(17,17,27,.96);color:#f9e2af;border:1px solid #45475a;border-radius:999px;padding:8px 14px;font:700 12px/1.2 monospace;box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:none;max-width:min(80vw,680px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      @media (max-width: 900px){
        #p15-solver-panel{right:8px;top:8px;width:min(300px,calc(100vw - 16px));max-width:calc(100vw - 16px)}
        .p15-body{padding:8px 10px;max-height:calc(100vh - 60px)}
        .p15-log{min-height:88px;max-height:140px}
      }
    </style>
    <div class="p15-hdr"><span>🧩 华容道求解器</span><span><button id="p15-toggle" style="background:none;border:none;color:#cdd6f4;cursor:pointer;font-size:16px">−</button><button id="p15-close" style="background:none;border:none;color:#cdd6f4;cursor:pointer;font-size:16px">×</button></span></div>
    <div class="p15-body" id="p15-body">
      <div class="p15-btns">
        <select id="p15-diff" style="background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;padding:4px 8px;font-size:12px">
          <option value="easy">入门 3×3</option>
          <option value="classic" selected>经典 4×4</option>
          <option value="hard">挑战 5×5</option>
        </select>
        <button id="p15-start">开始游戏</button>
        <button id="p15-solve" disabled>求解</button>
        <button id="p15-auto" disabled>一键还原</button>
      </div>
      <div class="p15-btns" style="align-items:center">
        <label style="font-size:11px;color:#a6adc8;display:flex;align-items:center;gap:4px">
          延迟ms
          <input type="number" id="p15-delay" value="80" min="40" max="3000" step="10" style="width:60px;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:4px;padding:3px 5px;font-size:11px">
        </label>
        <label style="font-size:11px;color:#a6adc8;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="p15-jitter" checked style="accent-color:#89b4fa">随机
        </label>
        <button id="p15-stop" style="display:none;background:#f38ba8;color:#1e1e2e">停止</button>
      </div>
      <div class="p15-status">
        <div class="p15-info" id="p15-info">就绪</div>
        <div class="p15-progress" id="p15-progress">idle</div>
      </div>
      <div id="p15-board-wrap"></div>
      <div class="p15-log" id="p15-log"></div>
    </div>`;
    document.body.appendChild(panel);
    restorePanelVisibility(panel);
    writePanelPageKind(getPageKind());
    let liveBadge = document.getElementById('p15-live-badge');
    if (!liveBadge) {
      liveBadge = document.createElement('div');
      liveBadge.id = 'p15-live-badge';
      liveBadge.textContent = '华容道脚本: idle';
      document.body.appendChild(liveBadge);
    }
    if (liveBadge) liveBadge.style.display = 'none';
    makeDraggable(panel, panel.querySelector('.p15-hdr'));
    $log = document.getElementById('p15-log');
    $info = document.getElementById('p15-info');
    $boardWrap = document.getElementById('p15-board-wrap');
    $btnStart = document.getElementById('p15-start');
    $btnSolve = document.getElementById('p15-solve');
    $btnAuto = document.getElementById('p15-auto');
    $btnStop = document.getElementById('p15-stop');
    $progress = document.getElementById('p15-progress');
    return panel;
  }

  if (window.top === window.self) mountPanel();

  if (panel) {
    document.getElementById('p15-toggle').onclick = () => {
      const b = document.getElementById('p15-body');
      b.style.display = b.style.display === 'none' ? '' : 'none';
    };

    document.getElementById('p15-close').onclick = () => {
      setPanelHidden(true);
      panel.style.display = 'none';
      const badge = document.getElementById('p15-live-badge');
      if (badge) badge.style.display = 'none';
    };
  }

  function setProgress(text) {
    if ($progress) $progress.textContent = text;
    const badge = document.getElementById('p15-live-badge');
    if (badge) badge.textContent = `华容道脚本: ${text}`;
  }

  function hasMountedPanel() {
    return !!panel && !!document.getElementById('p15-solver-panel');
  }

  function log(msg) { $log.textContent += msg + '\n'; $log.scrollTop = $log.scrollHeight; LOG(msg); }

  function clearStaleSolverState() {
    state.solution = null;
    state.moveIdx = 0;
    state.solving = false;
    state.playing = false;
    setProgress('idle');
    setControlsPlaying(false);
    $btnSolve.disabled = !state.board;
    $btnAuto.disabled = !state.board;
  }

  function getBlankPosition(board) {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === 0) return { r, c };
      }
    }
    return null;
  }

  function getTileForMove(board, dir) {
    const blank = getBlankPosition(board);
    if (!blank) return null;
    const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
    if (!delta) return null;
    const nr = blank.r + delta[0];
    const nc = blank.c + delta[1];
    if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length) return null;
    return board[nr][nc];
  }

  function renderBoard(board) {
    if (!board) return;
    const size = board.length;
    $boardWrap.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'p15s-board';
    grid.style.gridTemplateColumns = `repeat(${size}, 36px)`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.createElement('div');
        cell.className = 'p15s-cell' + (board[r][c] === 0 ? ' empty' : '');
        cell.textContent = board[r][c] || '';
        grid.appendChild(cell);
      }
    }
    $boardWrap.appendChild(grid);
  }

  // ═══════════════════════════════════════════════════════════════
  //  GAME STATE
  // ═══════════════════════════════════════════════════════════════
  let state = { sessionId: null, board: null, size: 0, solution: null, moveIdx: 0, playing: false, solving: false, minInterval: 50 };

  setInterval(() => {
    if (state.sessionId) claimSessionLock(state.sessionId);
  }, LOCK_HEARTBEAT_MS);

  window.addEventListener('pagehide', () => {
    if (!state.playing) clearSessionBinding();
  });

  function setControlsPlaying(playing) {
    $btnStart.disabled = playing;
    $btnSolve.disabled = playing || !state.board;
    $btnAuto.disabled = playing || !state.board;
    $btnStop.style.display = playing ? 'block' : 'none';
    setProgress(playing ? `running ${state.moveIdx}/${state.solution?.length || 0}` : (state.solution ? `ready ${state.solution.length}` : 'idle'));
  }

  function getMoveDelayMs() {
    const configured = Number.parseInt(document.getElementById('p15-delay').value, 10);
    const base = Number.isFinite(configured) ? configured : 80;
    const jitter = document.getElementById('p15-jitter').checked ? Math.floor(Math.random() * 120) : 0;
    return Math.max(base + jitter, state.minInterval || 0);
  }

  function toApiDirection(dir) {
    return dir;
  }

  function inferDifficultyFromSession(sess) {
    if (!sess) return document.getElementById('p15-diff').value;
    if (sess.difficulty) return sess.difficulty;
    const size = sess.size || sess.board?.length || 0;
    if (size === 3) return 'easy';
    if (size === 4) return 'classic';
    if (size === 5) return 'hard';
    return document.getElementById('p15-diff').value;
  }

  async function loadConfig() {
    const cfg = await api('GET', '/config');
    state.minInterval = cfg.min_interval_ms || 50;
    const delayInput = document.getElementById('p15-delay');
    delayInput.min = String(state.minInterval);
    if (Number.parseInt(delayInput.value, 10) < state.minInterval) {
      delayInput.value = String(state.minInterval);
    }
    log(`配置: min_interval=${state.minInterval}ms`);
  }

  function normalizeBoard(board) {
    if (!Array.isArray(board)) return null;
    if (!Array.isArray(board[0])) {
      const size = Math.sqrt(board.length);
      if (!Number.isInteger(size)) return null;
      const rows = [];
      for (let i = 0; i < board.length; i += size) rows.push(board.slice(i, i + size));
      return rows;
    }
    return board.map((row) => row.slice());
  }

  function applySession(sess, source) {
    const normalizedBoard = normalizeBoard(sess.board);
    if (!normalizedBoard) throw new Error('invalid board shape');
    const sessionId = String(sess.session_id || '');
    if (!ensureSessionOwnership(sessionId, source)) return false;
    state.sessionId = sessionId;
    state.board = normalizedBoard;
    state.size = normalizedBoard.length;
    state.solution = null;
    state.moveIdx = 0;
    state.solving = false;
    state.playing = false;
    renderBoard(state.board);
    document.getElementById('p15-diff').value = inferDifficultyFromSession({ ...sess, board: normalizedBoard, size: normalizedBoard.length });
    const tileCount = state.size * state.size;
    $info.textContent = `${source}  ${state.size}x${state.size} (${tileCount - 1}-puzzle)  moves: ${sess.move_count || 0}`;
    setProgress(`loaded ${sess.move_count || 0}`);
    log(`${source}: ${state.sessionId}`);
    setControlsPlaying(false);
    $btnSolve.disabled = false;
    $btnAuto.disabled = false;
    return true;
  }

  function getPuzzle15WorkerSource() {
    return `
      self.onmessage = (event) => {
        const { board } = event.data;
        const DIRECTION_ORDER = ['up', 'down', 'left', 'right'];
        const MOVE_VECTORS = {
          up: { dr: -1, dc: 0 },
          down: { dr: 1, dc: 0 },
          left: { dr: 0, dc: -1 },
          right: { dr: 0, dc: 1 },
        };
        const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
        const GOAL_CACHE = new Map();
        const SOLVER_LIMITS = {
          3: { exactMs: 10000, exactDepth: 40, beamMs: 2000, beamWidth: 4000, seenCap: 30000 },
          4: { exactMs: 45000, exactDepth: 100, beamMs: 5000, beamWidth: 12000, seenCap: 120000 },
          5: { exactMs: 0, exactDepth: 0, beamMs: 12000, beamWidth: 18000, seenCap: 220000 },
        };
        function flatten(board) {
          const flat = [];
          for (const row of board) for (const v of row) flat.push(v);
          return flat;
        }
        function goalFlat(size) {
          if (!GOAL_CACHE.has(size)) {
            const out = [];
            for (let i = 1; i < size * size; i++) out.push(i);
            out.push(0);
            GOAL_CACHE.set(size, out);
          }
          return GOAL_CACHE.get(size);
        }
        function goalKey(size) {
          return goalFlat(size).join(',');
        }
        function boardKey(flat) {
          return flat.join(',');
        }
        function isGoalFlat(flat) {
          for (let i = 0; i < flat.length - 1; i++) {
            if (flat[i] !== i + 1) return false;
          }
          return flat[flat.length - 1] === 0;
        }
        function manhattan(flat, size) {
          let dist = 0;
          for (let i = 0; i < flat.length; i++) {
            const v = flat[i];
            if (v === 0) continue;
            const goalR = Math.floor((v - 1) / size);
            const goalC = (v - 1) % size;
            const curR = Math.floor(i / size);
            const curC = i % size;
            dist += Math.abs(curR - goalR) + Math.abs(curC - goalC);
          }
          return dist;
        }
        function linearConflict(flat, size) {
          let conflicts = 0;
          for (let row = 0; row < size; row++) {
            for (let c1 = 0; c1 < size; c1++) {
              const v1 = flat[row * size + c1];
              if (!v1) continue;
              const goalRow1 = Math.floor((v1 - 1) / size);
              const goalCol1 = (v1 - 1) % size;
              if (goalRow1 !== row) continue;
              for (let c2 = c1 + 1; c2 < size; c2++) {
                const v2 = flat[row * size + c2];
                if (!v2) continue;
                const goalRow2 = Math.floor((v2 - 1) / size);
                const goalCol2 = (v2 - 1) % size;
                if (goalRow2 === row && goalCol1 > goalCol2) conflicts++;
              }
            }
          }
          for (let col = 0; col < size; col++) {
            for (let r1 = 0; r1 < size; r1++) {
              const v1 = flat[r1 * size + col];
              if (!v1) continue;
              const goalRow1 = Math.floor((v1 - 1) / size);
              const goalCol1 = (v1 - 1) % size;
              if (goalCol1 !== col) continue;
              for (let r2 = r1 + 1; r2 < size; r2++) {
                const v2 = flat[r2 * size + col];
                if (!v2) continue;
                const goalRow2 = Math.floor((v2 - 1) / size);
                const goalCol2 = (v2 - 1) % size;
                if (goalCol2 === col && goalRow1 > goalRow2) conflicts++;
              }
            }
          }
          return conflicts * 2;
        }
        function cornerConflict(flat, size) {
          if (size < 4) return 0;
          let penalty = 0;
          const last = size * size - 1;
          if (flat[0] !== 1 && (flat[1] === 1 || flat[size] === 1)) penalty += 2;
          if (flat[size - 1] !== size && (flat[size - 2] === size || flat[(size * 2) - 1] === size)) penalty += 2;
          const bottomLeft = size * (size - 1);
          const bottomRight = last;
          const bottomLeftGoal = bottomLeft + 1;
          if (flat[bottomLeft] !== bottomLeftGoal && (flat[bottomLeft + 1] === bottomLeftGoal || flat[bottomLeft - size] === bottomLeftGoal)) penalty += 2;
          if (flat[bottomRight - 1] !== last && (flat[bottomRight - 2] === last || flat[bottomRight - 1 - size] === last)) penalty += 2;
          return penalty;
        }
        function heuristic(flat, size) {
          return manhattan(flat, size) + linearConflict(flat, size) + cornerConflict(flat, size);
        }
        function isSolvable(flat, size) {
          let inversions = 0;
          for (let i = 0; i < flat.length; i++) {
            for (let j = i + 1; j < flat.length; j++) {
              if (flat[i] && flat[j] && flat[i] > flat[j]) inversions++;
            }
          }
          if (size % 2 === 1) return inversions % 2 === 0;
          const blankRow = Math.floor(flat.indexOf(0) / size);
          const fromBottom = size - blankRow;
          return (inversions + fromBottom) % 2 === 1;
        }
        function reconstructMoves(parents, key, startKey) {
          const out = [];
          let curKey = key;
          while (curKey !== startKey) {
            const entry = parents.get(curKey);
            if (!entry) return null;
            out.push(entry.move);
            curKey = entry.parent;
          }
          out.reverse();
          return out;
        }
        function exactSolve(board, size, timeBudgetMs, depthLimit) {
          if (!timeBudgetMs || !depthLimit) return { ok: false, reason: 'skipped_exact', sequence: [], stats: { algorithm: 'ida*', timeMs: 0 } };
          const flat = flatten(board);
          if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
          const t0 = Date.now();
          const state = new Uint8Array(flat);
          const blankIdx = flat.indexOf(0);
          let threshold = heuristic(state, size);
          let iterations = 0;
          function dfs(g, bound, blankPos, lastDir, path) {
            if (Date.now() - t0 > timeBudgetMs) return { status: 'timeout' };
            const h = heuristic(state, size);
            const f = g + h;
            if (f > bound) return { status: 'bound', value: f };
            if (h === 0) return { status: 'found', path: path.slice() };
            if (g >= depthLimit) return { status: 'bound', value: Infinity };
            let nextBound = Infinity;
            const br = Math.floor(blankPos / size);
            const bc = blankPos % size;
            const candidates = [];
            for (const dir of DIRECTION_ORDER) {
              if (lastDir && OPPOSITE[dir] === lastDir) continue;
              const move = MOVE_VECTORS[dir];
              const nr = br + move.dr;
              const nc = bc + move.dc;
              if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
              const nIdx = nr * size + nc;
              const movedTile = state[nIdx];
              state[blankPos] = movedTile;
              state[nIdx] = 0;
              const nextH = heuristic(state, size);
              state[nIdx] = movedTile;
              state[blankPos] = 0;
              candidates.push({ dir, nIdx, movedTile, score: nextH });
            }
            candidates.sort((a, b) => a.score - b.score || a.movedTile - b.movedTile);
            for (const candidate of candidates) {
              state[blankPos] = candidate.movedTile;
              state[candidate.nIdx] = 0;
              path.push(candidate.dir);
              const result = dfs(g + 1, bound, candidate.nIdx, candidate.dir, path);
              path.pop();
              state[candidate.nIdx] = candidate.movedTile;
              state[blankPos] = 0;
              if (result.status === 'found' || result.status === 'timeout') return result;
              if (result.value < nextBound) nextBound = result.value;
            }
            return { status: 'bound', value: nextBound };
          }
          while (iterations < 2000) {
            iterations += 1;
            const result = dfs(0, threshold, blankIdx, null, []);
            if (result.status === 'found') return { ok: true, sequence: result.path, stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations, steps: result.path.length } };
            if (result.status === 'timeout') return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
            if (!Number.isFinite(result.value)) return { ok: false, reason: 'depth_limit', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
            threshold = result.value;
          }
          return { ok: false, reason: 'max_iterations', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
        }
        function beamBidirectionalSolve(board, size, options) {
          const flat = flatten(board);
          if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
          if (isGoalFlat(flat)) return { ok: true, sequence: [], stats: { algorithm: 'beam-bidir', timeMs: 0, steps: 0 } };
          const t0 = Date.now();
          const goal = goalFlat(size);
          const startKey = boardKey(flat);
          const goalStateKey = goalKey(size);
          const beamWidth = options.beamWidth;
          const seenCap = options.seenCap;
          const timeBudgetMs = options.beamMs;
          const startParents = new Map([[startKey, { parent: null, move: null }]]);
          const goalParents = new Map([[goalStateKey, { parent: null, move: null }]]);
          const startSeenDepth = new Map([[startKey, 0]]);
          const goalSeenDepth = new Map([[goalStateKey, 0]]);
          let startFrontier = [{ flat, blankIdx: flat.indexOf(0), g: 0, h: heuristic(flat, size), lastDir: null, key: startKey }];
          let goalFrontier = [{ flat: goal.slice(), blankIdx: goal.indexOf(0), g: 0, h: 0, lastDir: null, key: goalStateKey }];
          let expanded = 0;
          let depth = 0;
          function expand(frontier, seenDepth, parents, otherParents, forward) {
            const next = [];
            let meetKey = null;
            for (const node of frontier) {
              if (Date.now() - t0 > timeBudgetMs) return { timeout: true };
              const br = Math.floor(node.blankIdx / size);
              const bc = node.blankIdx % size;
              const candidates = [];
              for (const dir of DIRECTION_ORDER) {
                if (node.lastDir && OPPOSITE[dir] === node.lastDir) continue;
                const move = MOVE_VECTORS[dir];
                const nr = br + move.dr;
                const nc = bc + move.dc;
                if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
                const nIdx = nr * size + nc;
                const nextFlat = node.flat.slice();
                const movedTile = nextFlat[nIdx];
                nextFlat[node.blankIdx] = movedTile;
                nextFlat[nIdx] = 0;
                const nextKey = boardKey(nextFlat);
                const nextDepth = node.g + 1;
                const prevDepth = seenDepth.get(nextKey);
                if (prevDepth !== undefined && prevDepth <= nextDepth) continue;
                const nextH = heuristic(nextFlat, size);
                const score = nextDepth + nextH;
                candidates.push({ flat: nextFlat, blankIdx: nIdx, g: nextDepth, h: nextH, score, lastDir: dir, key: nextKey, move: dir });
              }
              candidates.sort((a, b) => a.score - b.score || a.h - b.h);
              for (let i = 0; i < candidates.length; i++) {
                const child = candidates[i];
                seenDepth.set(child.key, child.g);
                parents.set(child.key, { parent: node.key, move: child.move });
                if (otherParents.has(child.key)) {
                  meetKey = child.key;
                  return { meetKey, next };
                }
                next.push(child);
              }
              expanded += 1;
            }
            next.sort((a, b) => a.score - b.score || a.h - b.h);
            if (next.length > beamWidth) next.length = beamWidth;
            if (seenDepth.size > seenCap) {
              const trimmed = new Map();
              for (const node of next) trimmed.set(node.key, node.g);
              for (const [key, value] of trimmed) seenDepth.set(key, value);
            }
            return { next };
          }
          while (startFrontier.length && goalFrontier.length) {
            if (Date.now() - t0 > timeBudgetMs) break;
            depth += 1;
            const expandStart = startFrontier.length <= goalFrontier.length;
            const result = expandStart
              ? expand(startFrontier, startSeenDepth, startParents, goalParents, true)
              : expand(goalFrontier, goalSeenDepth, goalParents, startParents, false);
            if (result.timeout) return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth } };
            if (result.meetKey) {
              const left = reconstructMoves(startParents, result.meetKey, startKey);
              const right = reconstructMoves(goalParents, result.meetKey, goalStateKey);
              if (!left || !right) return { ok: false, reason: 'reconstruct_failed', sequence: [], stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth } };
              const rightForward = right.slice().reverse().map((dir) => OPPOSITE[dir]);
              const sequence = left.concat(rightForward).map((dir) => OPPOSITE[dir]);
              return { ok: true, sequence, stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth, steps: sequence.length } };
            }
            if (expandStart) startFrontier = result.next;
            else goalFrontier = result.next;
          }
          return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'beam-bidir', timeMs: Date.now() - t0, expanded, depth } };
        }
        function solve2D(board, size) {
          const limits = SOLVER_LIMITS[size] || SOLVER_LIMITS[4];
          const exact = exactSolve(board, size, limits.exactMs, limits.exactDepth);
          if (exact.ok) return exact;
          const beam = beamBidirectionalSolve(board, size, limits);
          if (beam.ok) return beam;
          return exact.stats.timeMs >= beam.stats.timeMs ? exact : beam;
        }
        const size = board.length;
        const result = solve2D(board, size);
        self.postMessage(result);
      };
    `;
  }

  async function solveBoardAsync(board) {
    if (board.length >= 5) {
      return Puzzle15Solver.solve(board);
    }
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      return Puzzle15Solver.solve(board);
    }

    const worker = new Worker(URL.createObjectURL(new Blob([getPuzzle15WorkerSource()], { type: 'application/javascript' })));
    return await new Promise((resolve, reject) => {
      const timeoutMs = board.length === 3 ? 12000 : board.length === 4 ? 52000 : 15000;
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ ok: false, reason: 'timeout', sequence: [], stats: { timeMs: timeoutMs } });
      }, timeoutMs + 1000);

      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (error) => {
        clearTimeout(timer);
        worker.terminate();
        reject(error);
      };
      worker.postMessage({ board, timeBudgetMs: timeoutMs });
    });
  }

  function getRemainingPlays(me, difficulty) {
    const value = me?.daily_plays_remaining;
    if (typeof value === 'number' || typeof value === 'string') return value;
    if (value && typeof value === 'object') return value[difficulty] ?? value.remaining ?? JSON.stringify(value);
    return '?';
  }

  function logAccountInfo(me, difficulty) {
    const balance = me?.user?.balance ?? me?.balance ?? '?';
    const remaining = getRemainingPlays(me, difficulty);
    log(`余额: ${balance} | 难度: ${difficulty || '未知'} | 剩余: ${remaining}`);
  }

  function hasNoRemainingPlays(me, difficulty) {
    const remaining = getRemainingPlays(me, difficulty);
    return typeof remaining === 'number' ? remaining <= 0 : /^\d+$/.test(String(remaining)) && Number(remaining) <= 0;
  }

  async function resumeActiveSession() {
    try {
      const me = await api('GET', '/me');
      const sess = me?.active_session;
      if (sess && !sess.game_over && !sess.won && sess.board) {
        if (!applySession(sess, '继续未完局')) return false;
        showToast('已接管未完成华容道', 'warn');
        return true;
      }
    } catch (e) {
      log('读取未完局失败: ' + e.message);
    }
    return false;
  }

  async function startGame() {
    try {
      $info.textContent = '正在获取配置…';
      await loadConfig();
      const diff = document.getElementById('p15-diff').value;
      try {
        const me = await api('GET', '/me');
        logAccountInfo(me, diff);
        if (me?.active_session && !me.active_session.game_over && !me.active_session.won && me.active_session.board) {
          if (!applySession(me.active_session, '继续未完局')) return;
          showToast('已接管未完成华容道', 'warn');
          return;
        }
        if (hasNoRemainingPlays(me, diff)) {
          $info.textContent = '今日次数已用完';
          log(`当前难度 ${diff} 今日次数已用完`);
          showToast('今日次数已用完', 'warn');
          return;
        }
      } catch (accountError) {
        log('读取账号信息失败: ' + accountError.message);
      }

      $info.textContent = '正在开始游戏…';
      const res = await api('POST', '/start', { difficulty: diff });
      if (!applySession({ ...res, difficulty: diff }, '游戏已开始')) return;
      showToast('华容道已开始', 'info');
    } catch (e) {
      if (String(e.message || '').includes('409') && await resumeActiveSession()) return;
      $info.textContent = '错误: ' + e.message;
      log('ERROR: ' + e.message);
      showToast('开始游戏失败', 'error');
    }
  }

  $btnStart.onclick = startGame;

  async function computeSolution() {
    if (!state.board || state.solving) return !!state.solution;
    state.solving = true;
    setProgress('solving');
    $btnSolve.disabled = true;
    $info.textContent = '正在求解…';
    log('开始求解…');
    await sleep(0);
    const t0 = Date.now();
    const result = await solveBoardAsync(state.board);
    const elapsed = Date.now() - t0;
    if (result.ok) {
      state.solution = result.sequence.map(toApiDirection);
      const previewBoard = state.board.map((row) => row.slice());
      let previewOk = true;
      for (const dir of state.solution) {
        try {
          applyMove(previewBoard, dir);
        } catch {
          previewOk = false;
          break;
        }
      }
      const solvedPreview = previewOk && previewBoard.flat().every((v, idx, arr) => v === (idx + 1) % arr.length);
      state.moveIdx = 0;
      if (!solvedPreview) {
        state.solution = null;
        state.moveIdx = 0;
        $info.textContent = '求解失败: invalid-sequence';
        setProgress('solve-failed');
        log(`求解失败: invalid-sequence (${result.stats.algorithm || 'solver'})`);
        if (previewOk) log('原因: 序列执行后未到终局');
        else log('原因: 序列含非法移动');
        state.solving = false;
        $btnSolve.disabled = false;
        return false;
      }
      $info.textContent = `求解成功! ${result.stats.steps}步  ${elapsed}ms  ${result.stats.algorithm || 'solver'}`;
      setProgress(`ready ${result.stats.steps}`);
      log(`求解成功: ${result.stats.steps} 步, ${elapsed}ms, ${result.stats.algorithm || 'solver'}`);
      log(`序列: ${state.solution.join(' → ')}`);
      $btnAuto.disabled = false;
      state.solving = false;
      $btnSolve.disabled = false;
      return true;
    } else {
      $info.textContent = `求解失败: ${result.reason}`;
      setProgress('solve-failed');
      log(`求解失败: ${result.reason} (${elapsed}ms)`);
      state.solving = false;
      $btnSolve.disabled = false;
      return false;
    }
  }

  $btnSolve.onclick = () => {
    void computeSolution();
  };

  // ── apply a single direction to local board ──
  function applyMove(board, dir) {
    const size = board.length;
    let br = -1, bc = -1;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (board[r][c] === 0) { br = r; bc = c; }
    const delta = { up: [1, 0], down: [-1, 0], left: [0, 1], right: [0, -1] }[dir];
    if (!delta) throw new Error(`unknown dir: ${dir}`);
    const nr = br + delta[0], nc = bc + delta[1];
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) throw new Error(`illegal dir on local board: ${dir}`);
    board[br][bc] = board[nr][nc];
    board[nr][nc] = 0;
  }


  $btnStop.onclick = () => {
    state.playing = false;
    setProgress('stopping');
    log('已请求停止');
    $info.textContent = '正在停止…';
  };

  $btnAuto.onclick = async () => {
    if (state.playing) return;
    if (!state.board) {
      await startGame();
    }
    if (!state.solution) {
      const solved = await computeSolution();
      if (!solved) return;
    }
    if (!state.solution) return;
    state.playing = true;
    setProgress(`running ${state.moveIdx}/${state.solution.length}`);
    setControlsPlaying(true);
    const seq = state.solution;
    log(`一键还原: 共 ${seq.length} 步`);
    for (let i = state.moveIdx; i < seq.length; i++) {
      if (!state.playing) break;
      const dir = seq[i];
      try {
        const res = await api('POST', '/move', { session_id: state.sessionId, direction: dir });
        const nextBoard = normalizeBoard(res?.board || res?.session?.board || null);
        if (nextBoard) state.board = nextBoard;
        else applyMove(state.board, dir);
        renderBoard(state.board);
        state.moveIdx = i + 1;
        setProgress(`running ${state.moveIdx}/${seq.length}`);
        $info.textContent = `进度: ${i + 1}/${seq.length}  方向: ${dir}  moves: ${res.move_count}`;
        const badge = document.getElementById('p15-live-badge');
        if (badge) {
          badge.style.display = 'none';
          badge.textContent = `华容道脚本: ${i + 1}/${seq.length} ${dir}`;
        }
        log(`执行 ${i + 1}/${seq.length}: ${dir}`);
        if (res.won || (res.session && res.session.status === 'completed')) {
          log(`🎉 完成! 奖励: ${res.session?.reward_amount || '?'}`);
          setProgress('done');
          $info.textContent = `🎉 完成! 奖励: ${res.session?.reward_amount || '?'}`;
          state.playing = false;
          setControlsPlaying(false);
          showToast('🎉 华容道已还原', 'success');
          return;
        }
        await sleep(getMoveDelayMs());
      } catch (e) {
        log(`移动失败 [${dir}]: ${e.message}`);
        setProgress(`failed ${state.moveIdx}/${seq.length}`);
        $info.textContent = '移动失败: ' + e.message;
        state.playing = false;
        setControlsPlaying(false);
        showToast('华容道移动失败', 'error');
        return;
      }
    }
    log(state.playing ? '所有移动执行完毕' : '已停止');
    setProgress(state.playing ? 'done' : 'stopped');
    $info.textContent = state.playing ? '所有移动执行完毕' : '已停止';
    state.playing = false;
    setControlsPlaying(false);
  };

  function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    const bg = type === 'success' ? '#2f7a3a' : type === 'error' ? '#7a2f2f' : type === 'warn' ? '#7a5a2f' : '#3a4a7a';
    toast.style.cssText = `
      position:fixed;top:20px;left:50%;transform:translateX(-50%);
      z-index:100000;background:${bg};color:#fff;padding:10px 18px;
      border-radius:8px;font-size:14px;font-weight:700;
      box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .35s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, 2600);
  }

  function isPuzzle15Page() {
    const path = location.pathname.toLowerCase();
    if (path.includes('/custom/hub-entry')) return false;
    const text = `${document.title}\n${document.body?.innerText || ''}`;
    return path.includes('puzzle15') || /华容道|15-puzzle/i.test(text);
  }

  function ensurePanelVisible() {
    if (!hasMountedPanel()) {
      mountPanel();
    }
    if (!hasMountedPanel()) return;
    writePanelPageKind(getPageKind());
    if (!isPanelHidden()) panel.style.display = '';
    const badge = document.getElementById('p15-live-badge');
    if (badge) badge.style.display = isPanelHidden() ? 'none' : '';
  }

  function watchPage() {
    let ready = false;
    const tick = () => {
      const nowReady = isPuzzle15Page();
      if (nowReady && !ready) {
        ready = true;
        ensurePanelVisible();
        log('华容道页面就绪');
        void loadConfig().catch((e) => log('配置加载失败: ' + e.message));
        void resumeActiveSession();
      } else if (!nowReady && ready) {
        ready = false;
      }
    };
    tick();
    setInterval(tick, PAGE_POLL_MS);
  }

  watchPage();
  LOG('Userscript loaded');
})();
