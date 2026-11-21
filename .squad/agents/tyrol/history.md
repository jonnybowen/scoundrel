# Project Context

- **Owner:** Jonny Bowen
- **Project:** Scoundrel - a lightweight, web-based single-player dungeon card game (rules by Zach Gage & Kurt Bieg), styled after Balatro with crunchy pixel graphics, juicy animation, and sound.
- **Stack (assumed default):** TypeScript + Vite, HTML Canvas/WebGL with a CRT post-process shader, Web Audio API, Vitest + Playwright. Static site, no backend.
- **Created:** 2026-11-20

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- 2026-11-20: Implemented src/game engine (cards, mulberry32 rng + Fisher-Yates, createGame/step/queries, GameSession) against DR1 contract. With 44 cards the deck count after each refill is 40-3k, so the A4 final room always holds exactly 2 cards (carry + last deck card). The engine detects the final room as `deck.length === 0`, with no extra state flag. step only uses RNG in createGame, so GameState needs no RNG state. Added violation codes cannotAvoidFinalRoom and alreadyEntered (decision recorded). Tigh's helpers build hand-made GameStates with small decks, so the engine must never assume 44 cards when stepping. Colocated dev tests: src/game/engine.test.ts (200 random seeded games: card conservation, no input mutation, every legalAction accepted, replay reproduces state).

### 2026-11-20: Revised src/fx/director.ts to clear Adama's REJECT of Gaeta's FX director (lockout successor)
- Deal freeze: RoomRevealed starts 80 ms after the last CardDealt (deal gap < deal duration), so it took over cards still in flight. Fix: an enqueue-time model clock (steps chain exactly by `gap` while busy; reset when a batch hits an idle director) records each deal's landing time. The reveal step continues the shared `dealPose` trajectory until each card lands, and flips it at max(i*stagger, land). The step's duration grows to fit.
- Equip ghosts: the engine's WeaponEquipped.discarded already includes the replaced weapon, so the list is now deduped. The exit stagger is compressed to fit duration - 32 ms tail - 260 ms exit, so the last drawn frame at 60 fps is already at opacity 0.
- GameLost: cards with no layout home (the killing monster) fly to the discard and fade to 0 between 100 and 800 ms. The persist pose only ever applies to layout cards.
- Lesson: frame bugs hide behind passing cue-order and end-state tests. Step the director frame by frame (src/fx/director.frames.test.ts) and assert drawn invariants: no off-home freeze, and ghosts at opacity ~0 on the last frame before release. A fade that ends exactly at release still shows up to one frame of residual opacity, so leave a tail margin.
- Gotcha: skip() before any update() has no layout, so home lookups are undefined; don't gate end() bookkeeping on home().

### 2026-11-20: render-ui revision (successor to Starbuck after Adama's reject)
- A canvas that already has a WebGL context can't give you a 2D context. Never call getContext('webgl') on the display canvas. The CRT pass now uses its own detached canvas, the display is always 2D, and each frame is copied onto it with drawImage in the same task (preserveDrawingBuffer off). This one design covers shader compile failure, link failure, no WebGL and mid-game context loss: each falls back to the 2D blit. On restore the CRT comes back. destroy() and a failed init call WEBGL_lose_context.
- hitTest applies the warp only while the CRT is actually on screen (crtActive = crt && enabled && !lost).
- Rule outcomes now live in selectView: GameView.cardsLeftToResolve (final room, deck empty: every remaining card; otherwise min(CARDS_RESOLVED_PER_ROOM - resolved, inRoom); 0 when over or on the title screen), RoomCardView.kind (cardKind) and RoomCardView.lethal (cheapest available option >= hp; false when over). artKind is used only for choosing artwork.
- Weapon tray captions moved below the tray, so the room-card tooltip no longer covers FRESH/MAX in either orientation.
- How to probe: Playwright init scripts stub WebGLRenderingContext.prototype.getShaderParameter/getProgramParameter and capture contexts from getContext. Measure visibility with getImageData on the 2D display canvas (CRT about 0.78 lit because of the vignette, 2D blit about 0.96). Scratch vitest needs a plain-object .mjs config with root set to the repo.

### 2026-11-20: DR2 tutorial logic landed (uncommitted, for Adama's review)
- createGame({ deck }): a scriptedDeck() helper validates (RangeError on an empty deck or duplicate ids), copies the deck and skips the RNG factory entirely. Additive. All earlier tests still pass.
- src/tutorial/script.ts: the 30 steps are built from compact specs. The title is the lesson title, the default nudge is "PRESS NEXT (ENTER) TO CONTINUE." and arrow is always on. The data is deep-frozen. The recap is static, and chrome overrides its score from the engine.
- src/tutorial/machine.ts: card objects come from buildDeck() (no invented card data). The gate reuses a single matcher fn for expect and nudges, with select handled specially. The legality cross-check goes through engine step(). checkSync looks through info steps to the next action step, because NEXT has no state.
- Gotcha: a "missing expected card" desync after an action step that is followed by an info step can only be caught by looking ahead at completion time.
- Gotcha: Git Bash heredocs that contain big TS blocks with template literals broke (an unterminated heredoc). Use Edit/Write for TS source instead.
- Tests: src/tutorial/machine.test.ts (17) covers a golden playthrough with HP 20,20,10,14,10,20 and a win score of 30, the gate at every step, paging, desync and the deck option. Full suite: 256 tests, 19 files, green. typecheck green.

- 2026-11-20 (tutorial-ui lockout fix): #coach-live data-ready must come from the frame's latch state, not from fx.isBusy() after fx.update. app.ts refresh() records chromeLatched when it calls tutorial.chrome(), and mirrorCoach needs !chromeLatched && !fx.isBusy(). Learning: any value derived from state that is sampled before fx.update must not be re-checked against state sampled after it. A MutationObserver (step|ready) log in e2e catches these one-frame races reliably; the old code produced "r1Equip|false r1Equip|true r1Fight|true".


### 2026-11-21: fullscreen-layout revision (successor to Starbuck after Adama REJECT)
- The integer upscale threshold depends on dpr: 20% at dpr < 2 and 5% at dpr >= 2. If the long axis is derived only from floor(longDev/scale), a 16:9 window that snaps to an integer scale grows past 480 (1600x900@1 became 533x270). Capping it at the viewport aspect keeps 16:9 at 480x270.
- The safe box applies max(inset, CHROME_EDGE) and counts any letterbox towards the minimum. 16:9 has no spare length, so its frames do not change.
- Resize: lastLayout must be rebuilt in the same handler as renderer.resize. The e2e test proves it by dispatching a pointerdown from inside a window 'resize' listener added after the app's own listener, with an rAF counter to show no frame ran in between.
- The e2e suite runs against `npm run build && preview`, with reuseExistingServer when not in CI. Check that nothing stale is listening on :4173 first.
