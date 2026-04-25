// ==UserScript==
// @name         华容道自动求解器
// @namespace    https://sub.hdd.sb/
// @version      1.0.0
// @description  15-puzzle AI — IDA* 最优路径求解
// @match        https://sub.hdd.sb/
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const LOG = (...args) => console.log('[puzzle15-solver]', ...args);

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
    const MAX_EXACT_STEPS = { 3: 31, 4: 80, 5: 50 };
    const PHASE_LIMITS = {
      3: { exactMs: 8000, routeMs: 3000 },
      4: { exactMs: 25000, routeMs: 7000 },
      5: { exactMs: 8000, routeMs: 12000 },
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
      const out = [];
      for (let i = 1; i < size * size; i++) out.push(i);
      out.push(0);
      return out;
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

    function heuristic(flat, size) {
      return manhattan(flat, size) + linearConflict(flat, size);
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

    function createNode(flat, size, parent, move, depth) {
      const blankIdx = flat.indexOf(0);
      return {
        flat,
        size,
        parent,
        move,
        depth,
        blankIdx,
        h: heuristic(flat, size),
      };
    }

    function nodeScore(node) {
      return node.depth + node.h;
    }

    function compareNodes(a, b) {
      const fDiff = nodeScore(a) - nodeScore(b);
      if (fDiff !== 0) return fDiff;
      const hDiff = a.h - b.h;
      if (hDiff !== 0) return hDiff;
      return a.depth - b.depth;
    }

    function pathFromNode(node) {
      const out = [];
      let cur = node;
      while (cur && cur.parent) {
        out.push(cur.move);
        cur = cur.parent;
      }
      out.reverse();
      return out;
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
      return { flat: next, blankIdx: nIdx };
    }

    function exactSolve(board, size, timeBudgetMs, depthLimit) {
      const flat = flatten(board);
      if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
      const start = createNode(flat, size, null, null, 0);
      const t0 = Date.now();
      let threshold = start.h;
      let iterations = 0;
      const state = new Uint8Array(flat);

      function dfs(g, threshold, blankPos, lastDir, path) {
        if (Date.now() - t0 > timeBudgetMs) return { status: 'timeout' };
        const h = heuristic(state, size);
        const f = g + h;
        if (f > threshold) return { status: 'bound', value: f };
        if (h === 0) return { status: 'found', path: path.slice() };
        if (g >= depthLimit) return { status: 'bound', value: Infinity };

        let minExceed = Infinity;
        const br = Math.floor(blankPos / size);
        const bc = blankPos % size;
        const candidates = [];
        for (const name of DIRECTION_ORDER) {
          if (lastDir && OPPOSITE[name] === lastDir) continue;
          const move = MOVE_VECTORS[name];
          const nr = br + move.dr;
          const nc = bc + move.dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
          const nIdx = nr * size + nc;
          state[blankPos] = state[nIdx];
          state[nIdx] = 0;
          const nextH = heuristic(state, size);
          state[nIdx] = state[blankPos];
          state[blankPos] = 0;
          candidates.push({ name, nIdx, h: nextH });
        }
        candidates.sort((a, b) => a.h - b.h);

        for (const candidate of candidates) {
          state[blankPos] = state[candidate.nIdx];
          state[candidate.nIdx] = 0;
          path.push(candidate.name);
          const result = dfs(g + 1, threshold, candidate.nIdx, candidate.name, path);
          path.pop();
          state[candidate.nIdx] = state[blankPos];
          state[blankPos] = 0;
          if (result.status === 'found' || result.status === 'timeout') return result;
          if (result.value < minExceed) minExceed = result.value;
        }
        return { status: 'bound', value: minExceed };
      }

      while (iterations < 1000) {
        iterations += 1;
        const result = dfs(0, threshold, start.blankIdx, null, []);
        if (result.status === 'found') {
          return {
            ok: true,
            sequence: result.path,
            stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations, steps: result.path.length }
          };
        }
        if (result.status === 'timeout') {
          return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
        }
        if (!Number.isFinite(result.value)) {
          return { ok: false, reason: 'depth_limit', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
        }
        threshold = result.value;
      }
      return { ok: false, reason: 'max_iterations', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
    }

    function greedyRouteSolve(board, size, timeBudgetMs) {
      const flat = flatten(board);
      if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
      const t0 = Date.now();
      const start = createNode(flat, size, null, null, 0);
      const open = [start];
      const bestDepth = new Map([[boardKey(flat), 0]]);
      let expanded = 0;

      while (open.length) {
        if (Date.now() - t0 > timeBudgetMs) {
          return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'best-first', timeMs: Date.now() - t0, expanded } };
        }
        open.sort(compareNodes);
        const node = open.shift();
        const key = boardKey(node.flat);
        if (bestDepth.get(key) !== node.depth) continue;
        if (isGoalFlat(node.flat)) {
          const sequence = pathFromNode(node);
          return {
            ok: true,
            sequence,
            stats: { algorithm: 'best-first', timeMs: Date.now() - t0, expanded, steps: sequence.length }
          };
        }
        expanded += 1;
        for (const dir of DIRECTION_ORDER) {
          if (node.move && OPPOSITE[dir] === node.move) continue;
          const moved = applyMoveFlat(node.flat, size, node.blankIdx, dir);
          if (!moved) continue;
          const nextDepth = node.depth + 1;
          const nextKey = boardKey(moved.flat);
          const seenDepth = bestDepth.get(nextKey);
          if (seenDepth !== undefined && seenDepth <= nextDepth) continue;
          const child = createNode(moved.flat, size, node, dir, nextDepth);
          bestDepth.set(nextKey, nextDepth);
          open.push(child);
        }
      }
      return { ok: false, reason: 'exhausted', sequence: [], stats: { algorithm: 'best-first', timeMs: Date.now() - t0, expanded } };
    }

    function solve2D(board, size) {
      const limits = PHASE_LIMITS[size] || { exactMs: 5000, routeMs: 5000 };
      const exactDepth = MAX_EXACT_STEPS[size] || 40;
      const exact = exactSolve(board, size, limits.exactMs, exactDepth);
      if (exact.ok) return exact;
      const routed = greedyRouteSolve(board, size, limits.routeMs);
      if (routed.ok) return routed;
      return exact.stats.timeMs >= routed.stats.timeMs
        ? exact
        : routed;
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
      greedyRouteSolve,
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
    let dx=0, dy=0, ox=0, oy=0, dragging=false;
    handle.addEventListener('mousedown', e => {
      if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
      dragging=true; dx=e.clientX; dy=e.clientY;
      const r=panel.getBoundingClientRect();
      ox=r.left; oy=r.top;
      panel.style.bottom='auto'; panel.style.right='auto'; panel.style.top='auto'; panel.style.left='auto';
      panel.style.position='fixed'; panel.style.left=ox+'px'; panel.style.top=oy+'px';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if(!dragging) return;
      panel.style.left=(ox+e.clientX-dx)+'px';
      panel.style.top=(oy+e.clientY-dy)+'px';
    });
    document.addEventListener('mouseup', ()=>{ dragging=false; });
  }

  // ═══════════════════════════════════════════════════════════════
  //  UI PANEL
  // ═══════════════════════════════════════════════════════════════
  const panel = document.createElement('div');
  panel.id = 'p15-solver-panel';
  panel.innerHTML = `
    <style>
      #p15-solver-panel{position:fixed;top:10px;right:10px;z-index:99999;background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:8px;font-family:monospace;font-size:13px;width:320px;box-shadow:0 4px 24px rgba(0,0,0,.5)}
      #p15-solver-panel *{box-sizing:border-box}
      .p15-hdr{background:#313244;padding:8px 12px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move}
      .p15-hdr span{font-weight:bold;font-size:14px}
      .p15-body{padding:10px 12px}
      .p15-btns{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
      .p15-btns button{background:#89b4fa;color:#1e1e2e;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;flex:1;min-width:70px}
      .p15-btns button:hover{background:#74c7ec}
      .p15-btns button:disabled{opacity:.4;cursor:not-allowed}
      .p15-board{display:inline-grid;gap:2px;margin:6px 0;background:#181825;padding:4px;border-radius:4px}
      .p15-cell{width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:#313244;border-radius:3px;font-weight:bold;font-size:14px}
      .p15-cell.empty{background:#1e1e2e}
      .p15-log{background:#11111b;border:1px solid #313244;border-radius:4px;padding:6px;max-height:160px;overflow-y:auto;font-size:11px;margin-top:6px;white-space:pre-wrap;word-break:break-all}
      .p15-info{font-size:11px;color:#a6adc8;margin-bottom:4px}
    </style>
    <div class="p15-hdr"><span>🧩 华容道求解器</span><button id="p15-toggle" style="background:none;border:none;color:#cdd6f4;cursor:pointer;font-size:16px">−</button></div>
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
      <div class="p15-info" id="p15-info">就绪</div>
      <div id="p15-board-wrap"></div>
      <div class="p15-log" id="p15-log"></div>
    </div>`;
  document.body.appendChild(panel);
  makeDraggable(panel, panel.querySelector('.p15-hdr'));

  const $log = document.getElementById('p15-log');
  const $info = document.getElementById('p15-info');
  const $boardWrap = document.getElementById('p15-board-wrap');
  const $btnStart = document.getElementById('p15-start');
  const $btnSolve = document.getElementById('p15-solve');
  const $btnAuto = document.getElementById('p15-auto');
  const $btnStop = document.getElementById('p15-stop');

  document.getElementById('p15-toggle').onclick = () => {
    const b = document.getElementById('p15-body');
    b.style.display = b.style.display === 'none' ? '' : 'none';
  };

  function log(msg) { $log.textContent += msg + '\n'; $log.scrollTop = $log.scrollHeight; LOG(msg); }

  function renderBoard(board) {
    if (!board) return;
    const size = board.length;
    $boardWrap.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'p15-board';
    grid.style.gridTemplateColumns = `repeat(${size}, 36px)`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.createElement('div');
        cell.className = 'p15-cell' + (board[r][c] === 0 ? ' empty' : '');
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

  function setControlsPlaying(playing) {
    $btnStart.disabled = playing;
    $btnSolve.disabled = playing || !state.board;
    $btnAuto.disabled = playing || !state.board;
    $btnStop.style.display = playing ? 'block' : 'none';
  }

  function getMoveDelayMs() {
    const configured = Number.parseInt(document.getElementById('p15-delay').value, 10);
    const base = Number.isFinite(configured) ? configured : 80;
    const jitter = document.getElementById('p15-jitter').checked ? Math.floor(Math.random() * 120) : 0;
    return Math.max(base + jitter, state.minInterval || 0);
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

  function applySession(sess, source) {
    state.sessionId = sess.session_id;
    state.board = sess.board;
    state.size = sess.board.length;
    state.solution = null;
    state.moveIdx = 0;
    state.solving = false;
    renderBoard(state.board);
    document.getElementById('p15-diff').value = inferDifficultyFromSession(sess);
    $info.textContent = `${source}  ${state.size}x${state.size}  moves: ${sess.move_count || 0}`;
    log(`${source}: ${state.sessionId}`);
    $btnSolve.disabled = false;
    $btnAuto.disabled = false;
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
        const MAX_EXACT_STEPS = { 3: 31, 4: 80, 5: 50 };
        const PHASE_LIMITS = {
          3: { exactMs: 8000, routeMs: 3000 },
          4: { exactMs: 25000, routeMs: 7000 },
          5: { exactMs: 8000, routeMs: 12000 },
        };
        function flatten(board) {
          const flat = [];
          for (const row of board) for (const v of row) flat.push(v);
          return flat;
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
        function heuristic(flat, size) {
          return manhattan(flat, size) + linearConflict(flat, size);
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
        function createNode(flat, size, parent, move, depth) {
          const blankIdx = flat.indexOf(0);
          return { flat, size, parent, move, depth, blankIdx, h: heuristic(flat, size) };
        }
        function nodeScore(node) {
          return node.depth + node.h;
        }
        function compareNodes(a, b) {
          const fDiff = nodeScore(a) - nodeScore(b);
          if (fDiff !== 0) return fDiff;
          const hDiff = a.h - b.h;
          if (hDiff !== 0) return hDiff;
          return a.depth - b.depth;
        }
        function pathFromNode(node) {
          const out = [];
          let cur = node;
          while (cur && cur.parent) {
            out.push(cur.move);
            cur = cur.parent;
          }
          out.reverse();
          return out;
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
          return { flat: next, blankIdx: nIdx };
        }
        function exactSolve(board, size, timeBudgetMs, depthLimit) {
          const flat = flatten(board);
          if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
          const start = createNode(flat, size, null, null, 0);
          const t0 = Date.now();
          let threshold = start.h;
          let iterations = 0;
          const state = new Uint8Array(flat);
          function dfs(g, threshold, blankPos, lastDir, path) {
            if (Date.now() - t0 > timeBudgetMs) return { status: 'timeout' };
            const h = heuristic(state, size);
            const f = g + h;
            if (f > threshold) return { status: 'bound', value: f };
            if (h === 0) return { status: 'found', path: path.slice() };
            if (g >= depthLimit) return { status: 'bound', value: Infinity };
            let minExceed = Infinity;
            const br = Math.floor(blankPos / size);
            const bc = blankPos % size;
            const candidates = [];
            for (const name of DIRECTION_ORDER) {
              if (lastDir && OPPOSITE[name] === lastDir) continue;
              const move = MOVE_VECTORS[name];
              const nr = br + move.dr;
              const nc = bc + move.dc;
              if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
              const nIdx = nr * size + nc;
              state[blankPos] = state[nIdx];
              state[nIdx] = 0;
              const nextH = heuristic(state, size);
              state[nIdx] = state[blankPos];
              state[blankPos] = 0;
              candidates.push({ name, nIdx, h: nextH });
            }
            candidates.sort((a, b) => a.h - b.h);
            for (const candidate of candidates) {
              state[blankPos] = state[candidate.nIdx];
              state[candidate.nIdx] = 0;
              path.push(candidate.name);
              const result = dfs(g + 1, threshold, candidate.nIdx, candidate.name, path);
              path.pop();
              state[candidate.nIdx] = state[blankPos];
              state[blankPos] = 0;
              if (result.status === 'found' || result.status === 'timeout') return result;
              if (result.value < minExceed) minExceed = result.value;
            }
            return { status: 'bound', value: minExceed };
          }
          while (iterations < 1000) {
            iterations += 1;
            const result = dfs(0, threshold, start.blankIdx, null, []);
            if (result.status === 'found') return { ok: true, sequence: result.path, stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations, steps: result.path.length } };
            if (result.status === 'timeout') return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
            if (!Number.isFinite(result.value)) return { ok: false, reason: 'depth_limit', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
            threshold = result.value;
          }
          return { ok: false, reason: 'max_iterations', sequence: [], stats: { algorithm: 'ida*', timeMs: Date.now() - t0, iterations } };
        }
        function greedyRouteSolve(board, size, timeBudgetMs) {
          const flat = flatten(board);
          if (!isSolvable(flat, size)) return { ok: false, reason: 'unsolvable', sequence: [], stats: {} };
          const t0 = Date.now();
          const start = createNode(flat, size, null, null, 0);
          const open = [start];
          const bestDepth = new Map([[boardKey(flat), 0]]);
          let expanded = 0;
          while (open.length) {
            if (Date.now() - t0 > timeBudgetMs) return { ok: false, reason: 'timeout', sequence: [], stats: { algorithm: 'best-first', timeMs: Date.now() - t0, expanded } };
            open.sort(compareNodes);
            const node = open.shift();
            const key = boardKey(node.flat);
            if (bestDepth.get(key) !== node.depth) continue;
            if (isGoalFlat(node.flat)) {
              const sequence = pathFromNode(node);
              return { ok: true, sequence, stats: { algorithm: 'best-first', timeMs: Date.now() - t0, expanded, steps: sequence.length } };
            }
            expanded += 1;
            for (const dir of DIRECTION_ORDER) {
              if (node.move && OPPOSITE[dir] === node.move) continue;
              const moved = applyMoveFlat(node.flat, size, node.blankIdx, dir);
              if (!moved) continue;
              const nextDepth = node.depth + 1;
              const nextKey = boardKey(moved.flat);
              const seenDepth = bestDepth.get(nextKey);
              if (seenDepth !== undefined && seenDepth <= nextDepth) continue;
              const child = createNode(moved.flat, size, node, dir, nextDepth);
              bestDepth.set(nextKey, nextDepth);
              open.push(child);
            }
          }
          return { ok: false, reason: 'exhausted', sequence: [], stats: { algorithm: 'best-first', timeMs: Date.now() - t0, expanded } };
        }
        function solve2D(board, size) {
          const limits = PHASE_LIMITS[size] || { exactMs: 5000, routeMs: 5000 };
          const exactDepth = MAX_EXACT_STEPS[size] || 40;
          const exact = exactSolve(board, size, limits.exactMs, exactDepth);
          if (exact.ok) return exact;
          const routed = greedyRouteSolve(board, size, limits.routeMs);
          if (routed.ok) return routed;
          return exact.stats.timeMs >= routed.stats.timeMs ? exact : routed;
        }
        const size = board.length;
        const result = solve2D(board, size);
        self.postMessage(result);
      };
    `;
  }

  async function solveBoardAsync(board) {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      return Puzzle15Solver.solve(board);
    }

    const worker = new Worker(URL.createObjectURL(new Blob([getPuzzle15WorkerSource()], { type: 'application/javascript' })));
    return await new Promise((resolve, reject) => {
      const timeoutMs = board.length === 3 ? 9000 : board.length === 4 ? 27000 : 21000;
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
        applySession(sess, '继续未完局');
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
          applySession(me.active_session, '继续未完局');
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
      applySession({ ...res, difficulty: diff }, '游戏已开始');
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
    $btnSolve.disabled = true;
    $info.textContent = '正在求解…';
    log('开始 IDA* 求解…');
    await sleep(0);
    const t0 = Date.now();
    const result = await solveBoardAsync(state.board);
    const elapsed = Date.now() - t0;
    if (result.ok) {
      state.solution = result.sequence;
      state.moveIdx = 0;
      $info.textContent = `求解成功! ${result.stats.steps}步  ${elapsed}ms`;
      log(`求解成功: ${result.stats.steps} 步, ${elapsed}ms`);
      log(`序列: ${result.sequence.join(' → ')}`);
      $btnAuto.disabled = false;
      state.solving = false;
      $btnSolve.disabled = false;
      return true;
    } else {
      $info.textContent = `求解失败: ${result.reason}`;
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
    const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[dir];
    const nr = br + delta[0], nc = bc + delta[1];
    board[br][bc] = board[nr][nc];
    board[nr][nc] = 0;
  }

  async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  $btnStop.onclick = () => {
    state.playing = false;
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
    setControlsPlaying(true);
    const seq = state.solution;
    log(`一键还原: 共 ${seq.length} 步`);
    for (let i = state.moveIdx; i < seq.length; i++) {
      if (!state.playing) break;
      const dir = seq[i];
      try {
        const res = await api('POST', '/move', { session_id: state.sessionId, direction: dir });
        applyMove(state.board, dir);
        renderBoard(state.board);
        state.moveIdx = i + 1;
        $info.textContent = `进度: ${i + 1}/${seq.length}  方向: ${dir}  moves: ${res.move_count}`;
        if (res.won || (res.session && res.session.status === 'completed')) {
          log(`🎉 完成! 奖励: ${res.session?.reward_amount || '?'}`);
          $info.textContent = `🎉 完成! 奖励: ${res.session?.reward_amount || '?'}`;
          state.playing = false;
          setControlsPlaying(false);
          showToast('🎉 华容道已还原', 'success');
          return;
        }
        await sleep(getMoveDelayMs());
      } catch (e) {
        log(`移动失败 [${dir}]: ${e.message}`);
        $info.textContent = '移动失败: ' + e.message;
        state.playing = false;
        setControlsPlaying(false);
        showToast('华容道移动失败', 'error');
        return;
      }
    }
    log(state.playing ? '所有移动执行完毕' : '已停止');
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

  LOG('Userscript loaded');
})();
