# Project Context

- **Owner:** Jonny Bowen
- **Project:** Scoundrel - a lightweight, web-based single-player dungeon card game (rules by Zach Gage & Kurt Bieg), styled after Balatro with crunchy pixel graphics, juicy animation, and sound.
- **Stack (assumed default):** TypeScript + Vite, HTML Canvas/WebGL with a CRT post-process shader, Web Audio API, Vitest + Playwright. Static site, no backend.
- **Created:** 2026-11-20

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-11-20 — Scaffold + Design Review 1
- Toolchain resolved to TypeScript 7 (native tsc), Vite 8, Vitest 5, Playwright 1.65 on Node 24. Use moduleResolution "bundler"; three tsconfigs: tsconfig.json (app + unit tests, DOM), tsconfig.game.json (src/game with no DOM lib = purity gate), tsconfig.node.json (config files + e2e, Node types).
- `npm run build` runs typecheck first. Playwright webServer builds then previews on :4173; browsers need `npx playwright install chromium` on first run.
- Contracts live in src/game/{cards,rng,state,actions,events,engine,session}.ts, src/ui/view.ts (shared presentation types), src/render/types.ts, src/fx/types.ts, src/audio/types.ts. Stubs throw `not implemented: X (owner: Y)`.
- Rules: official text on weapon degradation reads "lower value (less than or equal)" — contradictory; defaulted to <= with an 'lt' RulesOptions variant. Other rulings A1-A10 in docs/RULES.md.
- Git Bash heredocs with many quoted blocks in one command failed to parse; prefer the Write tool for multi-file source writes on this machine.
