# Project Context

- **Owner:** Jonny Bowen
- **Project:** Scoundrel - a lightweight, web-based single-player dungeon card game (rules by Zach Gage & Kurt Bieg), styled after Balatro with crunchy pixel graphics, juicy animation, and sound.
- **Stack (assumed default):** TypeScript + Vite, HTML Canvas/WebGL with a CRT post-process shader, Web Audio API, Vitest + Playwright. Static site, no backend.
- **Created:** 2026-11-20

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-11-20: Rules test suite (Design Review 1 contracts)
- Suite lives in tests/unit: helpers.ts (makeState/room/c('S14') builders, expectViolation checks the state is unchanged, deepFreeze, mulberry32 testRng), plus cards, rng, actions, weapon, potions, rooms, scoring, game (createGame/events/determinism/purity/session), fuzz, contracts. It ran 140 of my cases plus Tyrol's src/game/engine.test.ts, all green against Tyrol's engine. typecheck is clean.
- Prefer hand-built GameStates over seeds for rules cases. GameState is plain JSON and step is pure, so no deck injection is needed.
- Scoundrel is hard. Uniform-random and one-ply greedy play won 0 of 300 real games, and a per-room search won 0 too (it reaches the final room in about 6% of games). Cover the win path with small hand-built dungeons (monsters capped at 8).
- With 44 cards the real final room always has exactly 2 cards (4 + 3*13 + 1). The 3-card and 0-card refill final rooms happen only in hand-built states.
- In scoring math, write `0 - x`, not `-x`: toBe uses Object.is, so -0 fails against 0.
- Mutation check recipe: copy src, tests, vitest.config.ts and package.json to scratch; make a junction to node_modules (PowerShell New-Item -ItemType Junction; Git Bash mklink mangles /J); sed one mutant at a time; remove the junction with `cmd /c rmdir` (never rm -rf it). All 10 mutants were killed.
- e2e: Chromium installed; the smoke test passes on desktop and Pixel 7 (placeholder canvas only).

### 2026-11-20: Review gate run-save (Starbuck, src/ui/save.ts): REJECT on tests, code correct
- Mutation recipe works with sed on a scratch copy plus a node_modules junction. Remove the junction with Git Bash `cmd //c rmdir "C:\\...\\node_modules"`. PowerShell Remove-Item and rmdir calls in the same command get blocked by the protected-path guard, so run the rmdir on its own.
- Vitest swallows console.log in this config. For perf probes, write the results to a file with fs.writeFileSync.
- A "never throws whatever the host provides" test in Node is vacuous unless you install a throwing getter with Object.defineProperty(globalThis, 'localStorage', {get(){throw}}) and restore it in finally.
- Incremental verifiers (prefix cache plus step) need tests that deal twice in a row (different seed, same seed with different rules) and a test with a matching prefix but a diverging state (same seed, scripted deck). Otherwise the seed, rules and compare guards can all be deleted without any test failing.
- Greedy play runs are short (about 27 actions max over 300 seeds). Full replay verify measured about 0.02 ms per action, so O(n^2) per run is negligible at about 100 actions.
