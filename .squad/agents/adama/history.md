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

### 2026-11-20 — Review: Tyrol's rules engine (APPROVE)
- Approved src/game engine/session/rng/cards. Accepted additive contract changes: RuleViolation 'cannotAvoidFinalRoom' and 'alreadyEntered', and cardIdOf. Tyrol's inbox entry records the binding semantics where the contract was silent.
- Deck math: 44 = 4 + 3*13 + 1, so the A4 final room is always 2 cards (avoids preserve the deck count). Verified empirically.
- Review technique: run an ad-hoc fuzz from the scratchpad with `npx vitest run --root <scratch dir>` and a plain `vitest.config.mjs` (a .ts config there cannot resolve vitest/config). Import vitest by absolute node_modules path and src/game/index by absolute path. Fuzz random legal play with deep-frozen states, card conservation, monotonic weapon stacks and replay equality. Random play almost never wins, so to cover the win and bonus paths, force hp >= 15 on each step.
- Colocated src/**/*.test.ts are allowed by vitest.config and compile under the purity gate (tsconfig.game.json).
- Open advisories: step(null) throws (typed contract excludes it); unknown action type maps to 'cardNotInRoom'.

### 2026-11-20 — Review: Gaeta's FX director + audio engine (REJECT, director.ts only)
- Rejected src/fx/director.ts for three bugs in held-card handling. (1) RoomRevealed takes ownership of cards still mid-deal, and its staggered flip holds them mid-air. (2) The equip discard lists the replaced weapon twice, because WeaponEquipped.discarded already contains it, and a long stagger releases ghost cards before they have faded. (3) The killing monster has no layout home after GameLost, so it pops out of view. The audio engine was clean.
- Accepted Gaeta's additive contracts: ghost cards in FxFrame.cards, optional setHover, createAudioEngine(opts?), and popup x/y as the text centre.
- Engine fact: a potion at full HP emits PotionUsed with healed 0 (A7). PotionWasted means only a second potion in the same room. Correct briefs that say otherwise.
- Review technique for FX: in a scratchpad vitest probe, step update() at 10-20 ms and log one card's pose and opacity each frame. A pose that stays still while off home, or a card that leaves fx.cards with opacity above 0 while it has no layout home, shows a hand-off bug that unit tests checking only cue order miss. Run it with `npx vitest run --root <scratch> --reporter=verbose` to see the console output.
- Ownership hand-off pattern to watch: when a newer step takes over a card from a step that is still active and its pose window starts later than t=0, the card freezes.

### 2026-11-20 — Review: Tigh's rules test suite (REJECT)
- Rejected tests/unit. (1) Nothing asserts the death-on-room-completion event contract (no RoomCleared, CardDealt or MonsterSlain when the 3rd or last card kills you). A reviewer mutant that emitted RoomCleared before GameLost survived 144/144. (2) The fuzz search tier runs 3.5-4.5s per test against Vitest's default 5s testTimeout under a full parallel run, and no timeout is configured.
- Accepted Tigh's decision that hand-built partial-deck states are legal input. Ruled CardDealt.deckRemaining = count after the deal.
- Review technique: copy src/game and tests/unit into scratchpad/mut with a plain vitest.config.mjs, mutate engine.ts there, and run `npx vitest run` from that directory. Tests import '../../src/game' relatively, so the mutant is what gets tested. `cmd //c mklink /J` fails from Git Bash, but it isn't needed.
- Always time the fuzz tiers inside the full parallel `npm test`, not in isolation. Contention roughly doubles their time (2.85s isolated vs 4.46s in the full run).
- Look for death paths that also complete a room. They are easy to miss when every death test kills on the first card.

### 2026-11-20 — Re-review: rules-tests revised by Gaeta (APPROVE)
- Approved tests/unit after Gaeta's revision. Lockout cleared with `node .squad/squad.mjs lockout approve rules-tests --reviewer adama`. Committed src/game and tests as bfdae0a.
- Death-on-room-completion is now pinned by exact events: 3rd card of a non-final room, barehanded and with a weapon; the final room's last card; and every losing batch in the fuzz test. Five independent death-path mutants each failed at least 2 tests.
- In the full parallel run, each fuzz test now takes 0.3 to 0.6s with 30s explicit timeouts. The search tier runs 100 seeds and still reaches the A4 endgame.
- Review technique: keep a pre-REJECT snapshot of the tests in the scratchpad. `git -c core.autocrlf=false diff --no-index <snapshot> tests/unit` then proves that nothing was weakened. Use `diff --strip-trailing-cr` when comparing to the working tree, because CRLF noise otherwise makes every file look rewritten.
- Before committing a slice, grep its imports so it doesn't depend on files that stay uncommitted.

### 2026-11-20 — Review: Starbuck's renderer, CRT and UI shell (REJECT)
- Rejected src/render and src/ui for two reasons. (1) If shader compile or link fails, the 2D fallback goes black: crt.ts claims getContext('webgl') before compiling, so the renderer's getContext('2d') on the same canvas returns null. (2) Render applies rules: the "resolve N more" hint hard-codes 3, LETHAL compares damage with hp, and the tooltip picks HEAL or EQUIP by suit. Ruled that selectView precomputes cardsLeftToResolve, RoomCardView.kind and RoomCardView.lethal.
- Accepted: the additive ui/view.ts fields (chrome, resolvedThisRoom, menu ButtonIds and intents, selectView(null)); LOGICAL_* in theme.ts; upscaling that is integer unless it wastes more than 20%, then fractional NN (1280x720 is fractional at 2.67x, Pixel 7 portrait is 4x); a single Settings writer (the app persists, audio gets { persist: false }); and the live HUD score kept as computeScore mid-game.
- Review technique: put Playwright probes in the scratchpad and import playwright with a file:/// URL (a bare C:/ path fails with ERR_UNSUPPORTED_ESM_URL_SCHEME). Run `npx vite preview --port 4173` in the background, then kill it via netstat/taskkill. To test fallbacks, inject failures with addInitScript: force getShaderParameter COMPILE_STATUS false, return null from getContext for webgl, or make localStorage throw. To test reduced motion, compare screenshots 700 ms apart with reducedMotion 'reduce'; they should be byte-identical. A screenshot PNG of about 2.6 kB means a black frame.
- A typecheck or build failure in a file another member is still editing (director.ts mid-fix) is not the reviewee's. Re-run once that edit lands.

### 2026-11-20 — Re-review: fx-director, Tyrol's revision (APPROVE)
- Approved src/fx/director.ts after Tyrol fixed all three held-card bugs. Reveal flips wait for each card's precomputed deal land time (modelDealLand on an enqueue-time modelClock). Equip discards are deduped with a compressed exit stagger. GameLost fades ghosts with no layout home to the discard. Committed src/fx + src/audio as 2f43308.
- Review technique: to prove regression tests bite when no pre-fix copy exists, copy src/fx, src/game, src/audio, src/ui/view.ts and settings.ts into scratchpad/fxmut/mN. Then revert each fix with a small node string-replace script and run the repo's vitest by absolute path (`node <repo>/node_modules/vitest/vitest.mjs run --root .`). A bare `npx vitest` in the scratch dir fails with "failed to find the current suite", because it resolves a different vitest instance.
- modelClock is only valid while steps chain contiguously. It resets when a batch arrives on an idle director, and flush() leaves the queue empty, so the next enqueue resets it too. Watch for that assumption if the step scheduling ever changes.

### 2026-11-20 — Re-review: render-ui, Tyrol's revision (APPROVE)
- Approved src/render, src/ui and src/main.ts after Tyrol's revision. Lockout cleared and committed as 4315d44. The display canvas is 2D only. The CRT draws on a detached WebGL canvas that is blitted across, so a compile, link or context failure cannot black out the display. selectView supplies cardsLeftToResolve, kind and lethal, and render reads only those.
- Ruled that a scratch probe satisfies an "add a probe or e2e check" requirement when the fix is structural. Moving the probe into the repo is a follow-up for Tigh.
- Review technique for the CRT hitTest: choose two probe points, one that hits a card only when warped and one that hits only when unwarped. For curvature 0.35 at landscape 480x270 these are logical (178.5,69), the gap that warps into slot 1, and (168.8,69), slot 0 warping into the gap. Hover each over a reduced-motion baseline and compare screenshots. Wait at least 800 ms after moving off a card first. With 250 ms, a hover-out tween tail (pixel delta up to 3) gave a false hit.
- Instrument HTMLCanvasElement.prototype.getContext in addInitScript and log (type, isDisplay) to prove the display canvas never requests webgl.
- Advisory: copying WebGL to 2D logs "GPU stall due to ReadPixels" in headless Chromium. Measure on real hardware before shipping.

### 2026-11-20 — Design Review 2: interactive tutorial (user directive)
- Designed a learn-by-doing tutorial on the real engine. The design is in docs/TUTORIAL.md. The contracts are stubs in src/tutorial, plus additive optional fields in ui/view, settings, fx/types and audio/types, and NewGameOptions.deck in the engine.
- Scripted deck (14 cards): D5 S8 C3 H5 | S14 C7 H10 | S6 C9 C4 H4 | D10 H2 C2. It covers 6 rooms in 30 steps and ends in GameWon with score 30. Rooms 2 and 5 are avoided, then return. I verified it by stepping a hand-built initial state with the real engine in a scratchpad vitest. With a deck option unimplemented, hand-building the state is the fastest way to check a script.
- Viewing the LETHAL flag means every option is lethal. Use a gate-refused barehanded fight to teach losing; don't rely on the badge.
- Adding a ButtonId breaks the exhaustive switches in render/renderer.ts buttonLabel and ui/input.ts targetToIntent. Adding an SfxId breaks the exhaustive Record in audio/synth.ts, so stage new ids as a separate type (TutorialSfxId) until the owner adds the voices.
- tsconfig.game.json now gates both src/game and src/tutorial for purity.

### 2026-11-20 — Review: Gaeta's tutorial FX and audio, DR2 (APPROVE)
- Approved src/fx/coach.ts, the director.ts tutorialCue hook, the three synth voices and the SfxId merge, plus 3 colocated test files. typecheck passes, npm test passes 239/239, and vite build succeeds. director.frames.test.ts is unmodified and passes.
- Regression technique: `git archive HEAD src | tar -x` into scratchpad/fxhead/repo, copy the fxrev probes and sed their absolute src import to the HEAD copy, then diff the probe console output against the working tree. Identical traces prove that a director hook didn't change timing.
- Advisories: coachOn in the director never resets, so FxFrame.coach persists into real runs (render must gate on chrome.tutorial). render/coach.ts:9 says reduced pulse is 0, but the contract says 0.5 (Starbuck).

### 2026-11-20 — Review: Tyrol's tutorial logic, DR2 (REJECT)
- Rejected src/tutorial/machine.ts for one gap. advance() moves to recap on GameWon only when the current step's trigger hits. A GameWon batch on any other step leaves the machine in 'coaching' with a won game: every move is refused and NEXT is a no-op, so the player is stuck. Required: any GameWon batch goes to recap, plus a regression test.
- Accepted all seven interpretations, including the look-ahead sync check (point 4) and engineAccepts as a pure pre-check (point 5). Also accepted the deck option: the default path is unchanged and it throws RangeError on an empty deck or duplicate ids.
- Script text verified mechanically. A node script pulled every quoted string from the TUTORIAL.md lesson section and diffed it against script.ts, and all 76 strings matched. Reuse this for any copy-heavy review.
- Review technique for state machines: walk every terminal event (GameWon, GameLost, violation) through every step, not only the step it is meant for. Then ask whether NEXT or any allowed move can still make progress. If none can, it is a stuck state.
- Advisories: an expected move that the engine refuses gives a nudge loop instead of a desync, and scriptedDeck doesn't validate card shape.
- npm run typecheck and npm run build were broken by Tigh's in-progress tests/unit/tutorial.test.ts (node:fs types, implicit any). Run `vite build` alone to separate that from the reviewee.

- 2026-11-20: Re-reviewed tutorial-machine (Gaeta revision after my R1 reject). GameWon now goes to recap before the trigger match, with GameLost still first. The header is updated, the regression test fails on the unfixed copy, and probe 3/3, typecheck and 322/322 pass. APPROVED; lockout cleared.

### 2026-11-20 — Review: tutorial-ui (Starbuck) REJECT, tutorial-tests (Tigh) APPROVE
- Rejected tutorial-ui for one DR2 gap. #coach-live data-ready is computed after fx.update (app.ts:511, :552-554), but the chrome came from refresh() before the update (:292). On the frame FX ends, the mirror shows the latched chrome of the step just completed with ready=true, for 127-216 ms per action step. Clearing: derive ready from the chrome actually mirrored (busy-at-refresh), plus a regression check.
- My reduced-pulse advisory is closed: coach.ts:29 STATIC_FX pulse 0.5.
- Approved tutorial-tests. The unit tests are commit-ready alone; the e2e files commit with the UI. The 2 Playwright skips are the CRT hover hit-tests on mobile-chromium, which is justified.
- Review technique for DOM test hooks: in addInitScript, attach a MutationObserver to the hook element and log each distinct (step:page:ready) with performance.now(). Stale "ready" windows show up directly. Screenshot diffs and passing e2e miss them.
- Review technique for text fit: in a scratchpad vitest, import layout.coachParts, widgets.wrapText and tutorialSteps(), then replicate drawCoach's widthFor to count lines per page and nudge against maxLines in both orientations. tutorialSteps is a function, not an array.
- Arithmetic trap in key-sequence probes: the welcome step has 2 pages, so count the NEXT presses per page, not per step, before calling a key "dropped".
