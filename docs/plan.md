# Puzzle15 Solver Skill Publication Plan

## Goal
Publish the completed `puzzle15-solver.user.js` as a clean public skill repo for agents working on the `https://sub.hdd.sb/` 15-puzzle game.

## Inputs
- Source script: local `puzzle15-solver.user.js`
- Reference repos: local memory solver and 2048 solver skill repos

## Deliverables
- `scripts/puzzle15-solver.user.js`
- `skills/sub-hdd-sb-puzzle15-solver/SKILL.md`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`
- `.gitignore`

## Security constraints
- Do not publish real auth token values, cookies, browser storage dumps, localhost auth headers, MCP secrets, GitHub tokens, or private config exports.
- Runtime `localStorage.getItem('auth_token')` reads are acceptable because the repository does not embed a secret.
- Keep domain names and relative API paths because they are required task scope.
- Keep local machine paths out of public-facing docs except this local publication plan.

## Repo shape
Mirror the existing solver skill repos:
- `scripts/` for the Tampermonkey userscript
- `skills/<skill-name>/SKILL.md` for agent routing and operational guidance
- English `README.md` as default
- Simplified Chinese `README.zh-CN.md`
- `docs/plan.md` as the versioned publication plan

## Publish flow
1. Create repo skeleton.
2. Copy the userscript unchanged unless a security issue is found.
3. Write retrieval-friendly skill and bilingual README files.
4. Run syntax and sensitive-string checks.
5. Initialize git, commit, create public GitHub repo, and push.
