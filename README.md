# HDD Puzzle15 Script

A domain-specific automation kit for the `https://sub.hdd.sb/` 15-puzzle game.

This repository packages two reusable assets:
- a Tampermonkey userscript solver for `/puzzle15-api`
- a Hermes skill for agents that need to operate, debug, or retrieve the solver workflow

The design principle is backend-first and solver-first: read the live session, solve the current board locally, then replay the move sequence through the API with rate-limit-aware delays.

## Why this repo exists
Generic agents often fail on 15-puzzle tasks because they:
- over-trust the rendered board instead of the backend session state
- do not preserve the exact current board before solving
- use shallow or non-admissible search on boards that need stronger planning
- miss active-session recovery and daily-play limits

This repo packages the proven userscript and a retrieval-friendly skill so agents can use the existing implementation instead of rebuilding it.

## Features
- automatic active-session takeover through `/me`
- backend-driven operation through relative API path `/puzzle15-api`
- size-aware support for current modes
  - `easy` -> `3x3`
  - `classic` -> `4x4`
  - `hard` -> `5x5`
- local IDA* solver with Manhattan distance and linear conflict
- fallback best-first route search when exact search times out
- Web Worker execution for expensive solves when available
- draggable on-page control panel with board preview, delay control, jitter, solve, stop, and one-click restore
- publish-safe packaging for agent retrieval and reuse

## Repository layout
- `scripts/puzzle15-solver.user.js` - Tampermonkey userscript
- `skills/sub-hdd-sb-puzzle15-solver/SKILL.md` - reusable Hermes skill
- `docs/plan.md` - publication plan
- `README.zh-CN.md` - Simplified Chinese README
- `LICENSE` - MIT license

## Quick start
### Userscript
1. Install Tampermonkey.
2. Open `scripts/puzzle15-solver.user.js`.
3. Create a new userscript and paste the file contents.
4. Visit `https://sub.hdd.sb/` and open the 15-puzzle game.
5. Use the in-page controls:
   - `开始游戏`
   - `求解`
   - `一键还原`
   - `停止`

### Hermes / agent usage
Copy `skills/sub-hdd-sb-puzzle15-solver/` into your Hermes skill tree, or absorb the routing vocabulary into your own agent system.

Suggested routing keywords:
- `sub.hdd.sb`
- `puzzle15`
- `puzzle15-api`
- `15 puzzle solver`
- `sliding puzzle solver`
- `IDA*`
- `linear conflict`
- `tampermonkey puzzle15`
- `华容道`
- `华容道求解器`
- `数字华容道`
- `3x3 puzzle`
- `4x4 puzzle`
- `5x5 puzzle`

## Operational model
1. Read `/config` to learn the current minimum move interval.
2. Read `/me` and prefer unfinished `active_session` when it has a board.
3. Infer difficulty from session difficulty or board size.
4. Solve the current board locally with IDA* plus linear conflict; use worker execution when available.
5. Replay moves through `/move` using `session_id` and direction.
6. Keep local board state, progress index, logs, and controls synchronized with API responses.

## Security model
This public repository intentionally excludes:
- actual auth tokens
- cookies or browser storage exports
- localhost headers or MCP secrets
- machine-specific private config
- GitHub tokens
- private account dumps

The script may read `localStorage.getItem('auth_token')` at runtime to call the site API, but no token value is embedded in this repository.

## Validation targets
- `easy` should solve `3x3` boards quickly.
- `classic` should solve `4x4` boards using IDA* within the configured worker budget when possible.
- `hard` should attempt `5x5` boards without freezing the page.
- logs should show solve status, move sequence, and replay progress.
- repository scans should find no real token, cookie, private path, or local config dump.

## License
MIT
