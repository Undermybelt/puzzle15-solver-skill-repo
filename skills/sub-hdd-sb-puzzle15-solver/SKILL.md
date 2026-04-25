---
name: sub-hdd-sb-puzzle15-solver
description: Use when automating, debugging, or routing agent work for the sub.hdd.sb 15-puzzle, puzzle15-api, sliding puzzle, digital Huarong Dao, or Tampermonkey puzzle15 solver.
tags: [sub.hdd.sb, puzzle15, puzzle15-api, tampermonkey, sliding-puzzle, huarongdao, ida-star, browser, agent, solver]
---

## When to use
- User asks to automate or debug the `https://sub.hdd.sb/` 15-puzzle game.
- User mentions `puzzle15-api`, 15-puzzle, sliding puzzle, digital Huarong Dao, 数字华容道, or 华容道求解器.
- User wants an agent workflow that reuses the existing Tampermonkey script instead of rebuilding solver logic.
- User needs retrieval keywords for browser automation, anything-analyzer, or Hermes routing around this puzzle.

## Keywords for routing
- sub.hdd.sb
- puzzle15
- puzzle15-api
- 15 puzzle solver
- sliding puzzle solver
- digital Huarong Dao
- 数字华容道
- 华容道
- 华容道求解器
- tampermonkey puzzle15
- IDA*
- ida star
- Manhattan distance
- linear conflict
- 3x3 puzzle
- 4x4 puzzle
- 5x5 puzzle
- active session takeover
- backend-driven solver

## Core facts
- The target site exposes game state through `/puzzle15-api`.
- Backend session state is the source of truth; page rendering is secondary.
- The script reads `/config`, `/me`, `/start`, and `/move`.
- Runtime `localStorage.getItem('auth_token')` is acceptable, but published repos must never include real token values.
- Current modes map by board size:
  - `easy`: `3x3`
  - `classic`: `4x4`
  - `hard`: `5x5`
- The solver uses IDA* with Manhattan distance plus linear conflict, then falls back to best-first route search when exact search times out.

## Workflow
1. Inspect config and active session first.
   - Call `/config` for `min_interval_ms`.
   - Call `/me` and prefer unfinished `active_session` with a valid `board`.
2. Treat backend state as source of truth.
   - Use `session_id`, `board`, `difficulty`, `move_count`, `game_over`, and `won` from API payloads.
3. Recover or start.
   - Resume unfinished sessions when present.
   - Otherwise call `/start` with inferred or selected difficulty.
4. Solve locally.
   - Normalize the 2D board.
   - Verify solvability.
   - Run IDA* with linear conflict; use Web Worker when available.
   - Keep the fallback best-first route search for timeout cases.
5. Replay through the backend.
   - POST `/move` with `session_id` and direction.
   - Respect configured delay and jitter.
   - Update local board preview and progress after each move.
6. Validate.
   - Check the script exposes `开始游戏`, `求解`, `一键还原`, and `停止`.
   - Confirm logs show solve status, sequence length, and replay progress.

## Implementation notes
- Keep the API path relative: `/puzzle15-api`.
- Preserve active-session takeover; it prevents 409 conflicts from breaking automation.
- Preserve worker-based solving for expensive boards.
- Keep the draggable panel, log output, delay input, and jitter controls because they help humans and agents verify runtime state.
- Do not embed local paths, exported storage dumps, MCP secrets, cookies, private headers, or real auth token values.

## Recommended repo layout
- `scripts/puzzle15-solver.user.js`
- `skills/sub-hdd-sb-puzzle15-solver/SKILL.md`
- `README.md`
- `README.zh-CN.md`
- `docs/plan.md`
- `LICENSE`

## Pitfalls
- Do not rebuild solver logic if the existing userscript is already available.
- Do not trust browser snapshots if `/puzzle15-api` shows a different live board.
- Do not publish browser storage snapshots or copied authorization headers.
- Do not remove delay handling; the backend may enforce a minimum interval.
- Do not treat `5x5` as guaranteed optimal; document timeout and fallback behavior.

## Verification
- Confirm the userscript has `@grant none` and relative API calls.
- Confirm `/me` takeover works on an unfinished session.
- Confirm IDA* logs a successful sequence on solvable boards.
- Confirm replay reaches `won` or completed session status when API state permits.
- Confirm no real token, cookie, private path, localhost auth header, or local config dump exists in the public repo.
