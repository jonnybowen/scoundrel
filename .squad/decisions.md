# Squad Decisions

## Active Decisions

### 2026-11-20: Architecture: pure event-sourced rules engine, presentation driven by GameEvent stream; module boundaries game/ui/render/fx/audio
**By:** Adama
**Recorded:** 2026-11-20T16-56-39
**References:** Tyrol, Starbuck, Gaeta, Tigh, docs/ARCHITECTURE.md
**Why:** Design Review 1 (scaffold). Stack: TypeScript 7 + Vite 8, Vitest 5 (Node env), Playwright 1.65 (desktop + Pixel 7 Chromium), no framework, static site.

Module boundaries:
- src/game (Tyrol): pure, DOM-free rules engine + GameSession. No Math.random, no timers, no I/O. Imports nothing from other src/ folders. Enforced by tsconfig.game.json (compiles src/game with lib ES2022 only) inside `npm run typecheck`.
- src/ui (Starbuck): GameView view model (selectView), LayoutSnapshot, HitTarget, UiIntent, Settings, app composition root (createApp). ui/view.ts is the neutral home for presentation types shared by render and fx.
- src/render (Starbuck): Renderer is a pure function of (GameView, LayoutSnapshot, FxFrame, time). Low logical resolution 480x270, WebGL CRT post-process upscale, 2D fallback. hitTest accounts for scale + CRT warp.
- src/fx (Gaeta): FxDirector queues event batches, emits FxFrame per frame (card transform overrides keyed by CardId, shake, flashes, HUD tweens, popups) and FxCue when an event lands.
- src/audio (Gaeta): AudioEngine with master/sfx/music buses, independent mute, unlock on first gesture, degrades to silence.

Flow: input -> hitTest -> UiIntent -> session.dispatch(GameAction) -> engine.step -> listeners(events, state) -> fx.enqueue -> fx cues -> audio.handleEvent.
Rules: presentation never diffs GameState; it consumes ordered GameEvents. Engine state jumps immediately, FX presents over time. UI ignores game actions while fx.isBusy(); tap = fx.skip(). Audio fires on FX cues (animation-synced), not dispatch.
Determinism: seed + rules + action log reproduces a game; GameState is plain JSON.
See docs/ARCHITECTURE.md.

### 2026-11-20: Engine contract: createGame/step reducer returning events; GameAction, GameEvent, RuleViolation shapes; rules rulings A1-A10
**By:** Adama
**Recorded:** 2026-11-20T16-56-39
**References:** Tyrol, Tigh, docs/RULES.md, src/game
**Why:** Engine API (src/game/engine.ts):
- createGame({ seed, rules?, rngFactory? }) -> { state, events }
- step(state, action) -> { ok: true, state, events } | { ok: false, state, violation }. Never throws on illegal input.
- Queries: legalActions, canAvoidRoom, canUseWeaponOn, weaponLimit, previewDamage, computeScore.
- GameAction: enterRoom | avoidRoom | playCard { cardId, mode?: 'weapon'|'barehanded' }. Engine never picks a fight mode for the player: missing mode when weapon is usable -> violation 'modeRequired'.
- GameEvent union: GameStarted, CardDealt (per card, with slot), RoomRevealed, RoomEntered, RoomAvoided, MonsterFought, DamageTaken, MonsterSlain, WeaponEquipped, PotionUsed, PotionWasted, RoomCleared, GameWon, GameLost.
- GameState: plain JSON; deck index 0 = top, avoided cards go to end; room = 4 positional slots (Card|null); cards keyed by stable id like "S14".
- RulesOptions: weaponLimit 'lte' (default) | 'lt'; lossScoreScope 'dungeon' (default, deck + unresolved room) | 'deckOnly'.

Rulings in docs/RULES.md: A1 weapon limit <= last slain (official text "lower value (less than or equal)" is self-contradictory; 'lt' variant kept). A3 loss score counts deck + unresolved room monsters. A4 when deck is empty after a deal, the room is final: may have <4 cards, cannot be avoided, all cards must be resolved; clearing it wins. A5 avoid sends all 4 incl. carried card to bottom, only before resolving any card. A6 HP clamped at 0. A7 potion at full HP still uses the room's potion. A8 win bonus applies if last resolved card was any heart (even wasted) and HP is 20. Contract changes require a Design Review.

### 2026-11-20: Engine contract additions: RuleViolation codes 'cannotAvoidFinalRoom' and 'alreadyEntered'; cardIdOf helper; engine semantics for legalActions/previewDamage/computeScore/replay
**By:** Tyrol
**Recorded:** 2026-11-20T17-01-52
**References:** Adama, Tigh, Starbuck, src/game/actions.ts, src/game/engine.ts, src/game/session.ts
**Status:** Proposed by Tyrol; ACCEPTED and made binding by Adama's review gate (2026-11-20T17-05-09, next entry).
**Why:** Additive contract changes (no existing shape changed):
1. RuleViolation gains { code: 'cannotAvoidFinalRoom' } (avoidRoom in the A4 final room, deck empty) and { code: 'alreadyEntered' } (enterRoom while phase is 'resolving'). The DR1 union had no code for either case, and step must never throw. avoidRoom precedence: gameOver > cannotAvoidAfterEntering > cannotAvoidTwice > cannotAvoidFinalRoom.
2. cards.ts exports cardIdOf(suit, rank) -> "S14" etc. Canonical buildDeck order: clubs 2..A, spades 2..A, diamonds 2..10, hearts 2..10.

Semantics where the contract was silent:
- legalActions order: enterRoom, avoidRoom (if allowed), then playCard per room slot left to right. Monsters are always listed with an explicit mode ('barehanded', plus 'weapon' when usable). Weapons and potions are listed with no mode. Empty when the game is over.
- weaponLimit under 'lt' returns lastSlain - 1 (the highest value it can still fight). weaponCannotFight.limit uses the same number.
- previewDamage is unclamped (matches MonsterFought.damage). 'weapon' with no weapon equipped returns barehanded damage. It ignores the degradation limit; use canUseWeaponOn to check legality. Non-monsters return 0.
- computeScore mid-game (live) = hp - sum(remaining monsters in the A3 scope). Won: hp + potion bonus. Lost: 0 - remaining monsters. This matches state.score at game end.
- When the player dies, the killing monster goes to the discard, even in weapon mode. No MonsterSlain is emitted, the room is not cleared, and unresolved room cards stay in their slots.
- Final room (A4): RoomCleared { carried: null } is emitted before GameWon.
- An implicit enter happens only on a legal playCard. A rejected play leaves phase 'choosing'.
- Seeds are normalized with >>> 0. RNG is mulberry32. seedFromString is FNV-1a 32-bit.
- Session: createSession does not broadcast the opening events (no listeners exist yet), so subscribe and then newGame to receive them. replay is atomic: on an illegal logged action it throws Error('replay: action #i ... rejected: <code>') and leaves the session unchanged. On success it emits exactly one combined batch.

### 2026-11-20: Review gate: APPROVE Tyrol's rules engine (src/game) and accept his additive contract changes (cannotAvoidFinalRoom, alreadyEntered, cardIdOf)
**By:** Adama
**Recorded:** 2026-11-20T17-05-09
**References:** Tyrol, Tigh, Starbuck, Gaeta, docs/RULES.md, src/game
**Why:** Verdict: APPROVE. src/game (cards, rng, actions, engine, session, engine.test.ts) as of 2026-11-20 working tree.

Checked against docs/RULES.md (A1-A10), docs/ARCHITECTURE.md and decisions.md. No gaps found.
- Weapon degradation compares against the LAST monster slain (slain[len-1]); 'lte' and 'lt' are both correct. An unused weapon has no limit. Equipping a weapon discards the old weapon and its stack.
- Only one potion per room heals; the flag resets on every deal (A7: a potion at full HP still uses it up).
- Avoid rules: allowed only in 'choosing', never twice in a row, never in the final room. A5: avoided cards go to the bottom in slot order.
- The carried-over card keeps its slot and refills go left to right. A4: the final room (deck empty after a deal) is always 2 cards, cannot be avoided, and must be fully resolved; clearing it emits RoomCleared and then GameWon.
- Scoring: win = hp, plus the potion value when hp is 20 and the last card resolved was any heart (A8). Loss = 0 minus monsters in the A3 scope ('dungeon' or 'deckOnly'); the killing monster is excluded. A6: HP clamps at 0 and DamageTaken.amount is unclamped.
- step does not mutate its input (checked by deep-freezing and JSON-snapshotting the state across 3000 seeded random games). Rejections return the same state object. Cards are conserved (44 unique) at every step.
- The engine is DOM-free (tsc -p tsconfig.game.json is clean). Play is deterministic. session.replay rebuilds a state byte-identical to the live game. Event order matches the canonical order documented in events.ts.
- npm run typecheck is clean. npm test: 118/119 pass. The one failure is Tigh's stale stub test in tests/unit/contracts.test.ts.

Contract ruling (I own the contract): ACCEPTED.
1. RuleViolation 'cannotAvoidFinalRoom' and 'alreadyEntered', precedence gameOver > cannotAvoidAfterEntering > cannotAvoidTwice > cannotAvoidFinalRoom. These are additive and needed because step must not throw.
2. cardIdOf(suit, rank): additive, and it matches the documented CardId format.
3. The semantics Tyrol recorded where the contract was silent are now binding: legalActions shape and order; weaponLimit 'lt' = last - 1; previewDamage unclamped; live computeScore = hp - A3-scope monsters; the killing monster goes to discard with no MonsterSlain; RoomCleared before GameWon; a rejected play does not enter the room; createSession does not broadcast its opening events; replay is atomic and throws on an illegal log.

Advisories (not required): guard step against null/non-object actions; unknown action types currently return 'cardNotInRoom', so consider an 'unknownAction' code at the next Design Review; an unrecognised mode string silently fights barehanded; rename freezeDraft (it does not freeze); validate the values in opts.rules.

Follow-ups for others: Tigh must delete or update the stale stub test in contracts.test.ts. Starbuck must subscribe and then call newGame to receive opening events, and wrap replay in try/catch when loading saves. Gaeta must note that the killing blow emits no MonsterSlain (the card goes to the discard).

### 2026-11-20: FX/audio contract clarifications: ghost cards in FxFrame, optional setHover, optional createAudioEngine opts, FX timing table
**By:** Gaeta
**Recorded:** 2026-11-20T17-09-29
**References:** Starbuck, Adama, Tigh, src/fx/types.ts, src/audio/types.ts, src/fx/director.ts
**Status:** Proposed by Gaeta. Items 1-4 ACCEPTED as binding contract by Adama's review gate (2026-11-20T17-13-52). Items 5-6 (FX_TIMING values, v^2 volume curve, 0.55 music scale) were ruled implementation details, not contract. The volume-persistence note in item 6 is superseded by ruling (d) of 2026-11-20T17-21-25 (single Settings writer: ui/app).
**Why:** Additive or clarifying only. No existing contract shape is broken.
1) FxFrame.cards may contain "ghost" cards that are absent from GameView/LayoutSnapshot (cards being discarded, slain barehanded, swept back into the deck, or a potion flying into the HP meter) while their exit tween plays. Render must draw any card in fx.cards from its CardId (suit letter + rank), even when it isn't in the view. Cards that are locked but not dealt yet are present with opacity 0, and render should honor that (screen never shows the future). Room cards also carry a small idle bob transform while they sit at home, so render should always apply fx.cards when present.
2) FxDirector gains an OPTIONAL method setHover?(cardId | null). ui/ forwards hover HitTargets of kind 'card' to it, which adds lift and a tilt wobble. It's optional, so existing mocks still compile.
3) createAudioEngine(opts?: AudioEngineOptions) takes an optional { createContext?, persist? } for tests. A call with no args behaves as specified.
4) Popup x/y is the text's centre anchor in logical px.
5) Timings live in FX_TIMING (src/fx/director.ts). A typical fight takes about 0.9s busy, and a fight that clears the room and deals a new one takes about 1.8s. Tap-to-skip snaps instantly. With reduced motion, everything completes on the next update(), every cue still fires, there's no shake/flash/CRT pulse, and popups stay (static).
6) Audio volume uses a squared curve (v^2) on bus gains. Music bus is additionally scaled by 0.55 for mix balance. Volume/mute persist by merging into loadSettings() then saveSettings().
Why: The engine jumps state instantly, so FX must be able to present cards that have already left the view, and hover feel needs a channel into FX without re-deriving it in render.

### 2026-11-20: Rules tests construct explicit GameStates (partial decks); engine must step any consistent hand-built state
**By:** Tigh
**Recorded:** 2026-11-20T17-10-20
**References:** Tyrol, Adama, tests/unit/helpers.ts, tests/unit/fuzz.test.ts, docs/RULES.md
**Status:** Proposed by Tigh; partial-deck ruling ACCEPTED and binding per Adama's review gate (2026-11-20T17-15-01). The search-tier seed count was later cut from 300 to 100 in the approved revision (2026-11-20T17-21-09).
**Why:** Rules tests in tests/unit build GameStates by hand (tests/unit/helpers.ts makeState) and call step() on them instead of depending on shuffle internals. These states are internally consistent (unique card ids, room = 4 slots, resolvedThisRoom matches empty slots) but usually hold far fewer than 44 cards. Binding consequence for the engine: step/legalActions/computeScore must derive everything from the state as given, and never from the assumption of a full 44-card dungeon. The final room is recognised by deck.length === 0 (A4), including the 3-card and 0-card refill cases that cannot happen in a real 44-card game.

Other test conventions:
- Fuzz (tests/unit/fuzz.test.ts) runs three tiers: uniform random play on real games (300 seeds x 2 rule variants), a per-room exhaustive-search policy on real games (reaches the A4 final room; asserts every real final room has exactly 2 cards), and 500 random small hand-built dungeons per variant (the only tier that produces wins). Uniform random play and one-ply greedy play won 0 of 300 real games, so real-game fuzz alone never covers the win path.
- Mutation-checked: 10 hand-made engine mutants (lte/lt, potion flag, avoid-twice, deckOnly, bonus, HP clamp, avoid flag, final-room clear, weapon damage) were each killed by the suite.
- Tyrol's decisions on previously silent semantics (alreadyEntered, cannotAvoidFinalRoom and its precedence, RoomCleared before GameWon in the final room, mid-game computeScore, replay atomicity, legalActions monster modes) are now asserted by tests. Changing any of them breaks tests on purpose.

### 2026-11-20: Review gate: REJECT Gaeta's FX director (src/fx/director.ts) for three held-card/timing bugs; audio engine clean; accept Gaeta's four additive FX/audio contract changes
**By:** Adama
**Recorded:** 2026-11-20T17-13-52
**References:** Gaeta, Tyrol, Starbuck, Tigh, src/fx/director.ts, src/fx/types.ts, src/audio/types.ts
**Status:** The REJECT verdict on src/fx/director.ts is SUPERSEDED by the APPROVE re-review of 2026-11-20T17-22-41 (Tyrol's revision, commit 2f43308). The contract ruling below remains binding.
**Why:** Verdict: REJECT (scope: src/fx + src/audio submission). typecheck, 179 tests and build all pass; the bugs below were reproduced with a scratch probe.

Required changes (all in src/fx/director.ts; the lockout applies to that file, so a different agent revises it. Recommended: Tyrol):
1. Deal freezes mid-flight (director.ts:41 deal gap 80 vs RoomRevealed 643-670). RoomRevealed starts 80 ms after the last CardDealt and takes ownership of cards that are still flying. The flip window starts at i*60, which holds pose = from, so slots 1-3 hang mid-air. Measured: slot 3 stops at x=219.7 (home 270) from 480 to 640 ms. This happens on every deal. Fix: per card, start the flip only after that card's deal has landed (or wait for the last deal to finish before RoomRevealed starts, or continue the deal trajectory inside the flip pose). Add a test that each dealt card moves toward home without holding still off-home.
2. Equip discard ghosts pop (director.ts:1042, 1073). The engine's WeaponEquipped.discarded already includes the replaced weapon (engine.ts:266), so `old` lists that card twice. The (i-1)*30 stagger plus 260 ms also runs past the 460 ms step, so stacks of 6 or more are released at opacity 0.19 to 0.77 and vanish. Fix: dedupe, and scale the stagger so every exit window ends at or before the duration. Test with an 8-card stack.
3. The killing monster vanishes after GameLost (director.ts:866-898). The killing monster has no layout home, because the engine discarded it. It is held at 0.45 opacity for the whole lost sequence and then disappears on release, while the remaining room cards keep the persisted defeat pose. Fix: in the lost step, send home-less cards to the discard or fade them to 0. Add a general invariant test: a ghost card (in fx.cards but not in layout.cards) has opacity ~0 on its last frame before release.

Contract ruling (accepted as additive, binding):
(1) FxFrame.cards may contain ghost cards that are absent from GameView and the layout. Render draws them from the CardId, honours opacity (including 0 for held-back cards) and faceUp < 0.5 = back. Render always applies fx.cards when present.
(2) Optional FxDirector.setHover?(cardId | null), forwarded by ui for card hovers. Cosmetic only.
(3) createAudioEngine(opts?: { createContext?, persist? }). Calling it with no arguments keeps the DR1 behaviour.
(4) Popup x/y is the text centre in logical px.
FX_TIMING values, the v^2 volume curve and the 0.55 music scale are implementation details, not contract.

Event semantics checked: RoomEntered first (handled); killing blow Fought -> DamageTaken -> GameLost with no MonsterSlain (cue order correct, but see item 3); RoomCleared before GameWon (handled). Correction to the review brief: a potion at full HP emits PotionUsed with healed 0 (RULES A7, engine.ts:277-282), not PotionWasted. PotionWasted means only a second potion in the same room. FX ('FULL' popup) and audio (soft heal) handle both cases correctly.

Audio: no required changes. Advisories: RoomRevealed always plays 4 flips; dispose leaves the sequencer interval running for about 150 ms against a closed context, and tick() is unguarded; persist() writes the matchMedia reducedMotion default into storage; ui and audio both write Settings (coordinate a single writer with Starbuck).

### 2026-11-20: Review gate: REJECT Tigh's rules test suite (tests/unit). Death-on-room-completion events unasserted; fuzz search tier near Vitest's 5s default timeout. Tigh's partial-deck decision ACCEPTED.
**By:** Adama
**Recorded:** 2026-11-20T17-15-01
**References:** Tigh, Tyrol, tests/unit/scoring.test.ts, tests/unit/fuzz.test.ts, src/game/events.ts
**Status:** The REJECT verdict is SUPERSEDED by the APPROVE of 2026-11-20T17-21-09 (Gaeta's revision, commit bfdae0a). The partial-deck ruling and the CardDealt.deckRemaining / GameStarted.deckSize rulings below remain binding.
**Why:** Verdict: REJECT. No commit made. The coordinator must route the revision to an agent other than Tigh (reviewer lockout).

Commands: npm run typecheck exits 0. npm test passes 179/179 in about 11 to 16s wall time. npm run test:e2e passes 2/2 (desktop-chromium and mobile-chromium) in 6.4s.

Required changes:
1. tests/unit/scoring.test.ts:43 and :70, plus the fuzz tier at tests/unit/fuzz.test.ts:73. Nothing asserts the event contract when the player dies on a card that completes a room: the 3rd card of a normal room, or the last card of the final room. src/game/events.ts sets the canonical order "MonsterSlain | GameLost -> RoomCleared (if 3rd card)". Tyrol's accepted decision says that on death "No MonsterSlain is emitted, the room is not cleared, and unresolved room cards stay in their slots". The only exact-sequence death test (line 43) dies on the room's first card. The test at line 70 checks only that GameWon is absent. The fuzz test checks only that GameLost is the last event. Reviewer mutation: emitting RoomCleared before GameLost when death completes a room survived the whole suite (144/144 green). This breaks the "event emission and order" requirement and a recorded decision. Fix:
   - Add a test where the player dies on the 3rd card of a non-final room (resolvedThisRoom 2, deck non-empty). Assert that the events are exactly MonsterFought, DamageTaken, GameLost, with no RoomCleared, CardDealt or RoomRevealed. Assert that the carried card is still in its slot, the deck is unchanged, and the killing monster is in the discard. Cover weapon mode as well: weapon.slain must be unchanged.
   - At line 70, assert the exact event types.
   - In the fuzz test, assert that a losing batch contains no MonsterSlain or RoomCleared.
2. tests/unit/fuzz.test.ts:151. The search-policy tier took 3.5 to 4.5s per test during a full parallel run on an 8-core machine. That is against Vitest's default 5000ms testTimeout, and no timeout is configured anywhere. On a slower or CI machine this fails on wall-clock time even though the logic is deterministic, which breaks the "bounded, deterministic, no flakiness" requirement. Fix: give each fuzz `it` an explicit timeout (for example 30_000). Also cut the search tier's seed count (for example to 100) or its cost, so the file stays well under the default. Keep the assertions that a final room is reached and that real final rooms hold exactly 2 cards.

Ruling on Tigh's decision (hand-built partial-deck GameStates): ACCEPTED and binding. GameState is plain JSON by contract and step is a pure function of (state, action). The engine must derive everything from the state as given, and must recognise the final room by deck.length === 0 alone. Also binding as of this review: CardDealt.deckRemaining is the deck count after the card is dealt, and GameStarted.deckSize is the pre-deal size (44). The events.ts doc comment should say so on the next contract touch.

Coverage otherwise verified against the requirements:
- deck composition;
- all 9 violation codes, with state unchanged on rejection;
- the A2 rulebook example, plus lte and lt boundaries;
- potion once per room, plus A7;
- avoid ordering, A5, avoid-twice and re-allow;
- A4 final rooms of 4, 2 and 1 cards;
- both lossScoreScope values, A6, and A8;
- determinism and replay;
- deep-freeze purity;
- session.
Every implementation-specific assertion traces to Tyrol's accepted decision.

### 2026-11-20: Presentation contract additions (ui/view.ts) and renderer/layout conventions
**By:** Starbuck
**Recorded:** 2026-11-20T17-15-37
**References:** Adama, Gaeta, Tigh, Tyrol, src/ui/view.ts, src/render/types.ts
**Status:** Proposed by Starbuck; ruled on by Adama's review gate (2026-11-20T17-21-25). Accepted: the ButtonId/UiIntent/GameView/selectView additions, LOGICAL_WIDTH/HEIGHT location, the 20% fractional-upscale rule, and the single Settings writer. SUPERSEDED in part: render must no longer flag LETHAL itself (or derive hint counts or HEAL/EQUIP); selectView must precompute GameView.cardsLeftToResolve, RoomCardView.kind and RoomCardView.lethal instead.
**Why:** All changes are additive to contracts Starbuck owns. No game/fx/audio contract was changed.

ui/view.ts
- ButtonId adds 'crt' | 'motion' | 'volDown' | 'volUp' | 'closeMenu' (settings menu).
- UiIntent adds closeSettings, toggleCrt, toggleReducedMotion, changeVolume{delta}, skip.
- GameView adds `resolvedThisRoom: number` and `chrome: ViewChrome` (screen 'title'|'game', menuOpen, hover, toast, showResult, settings, error). Render draws menus/overlays/settings readouts only from this, never from GameState.
- UiLocalState adds screen, hover, toast, showResult, settings, error.
- selectView(state: GameState | null, ui): null (or screen 'title') gives the empty title view. RoomCardView.damageBarehanded is non-null exactly for monsters (UI uses that instead of re-deriving kind). previewDamage values stay raw (unclamped); render flags LETHAL when the best option >= hp. [Superseded by 2026-11-20T17-21-25 required change 2: use RoomCardView.lethal from selectView.]
- Keyboard map: 1-4, W/B, A, Enter, M, N, plus S settings, C CRT, Esc cancel/close, Space skip. On the result screen only Enter/N restart; Space never does, because it gets mashed to skip animations.

render
- LOGICAL_WIDTH/HEIGHT now live in render/theme.ts and are re-exported from render/types.ts (same names and values). Portrait logical size is 270x480 (axes swapped). Orientation = viewport taller than wide.
- computeLayout is implemented in render/layout.ts and re-exported from render/types.ts. Layout `cards` holds room cards, the weapon card (at layout.weapon) and the slain fan. Buttons present = only the active ones. If 'newGame' or 'closeMenu' is present the screen is modal and hitTest ignores cards.
- Upscale: integer device-pixel scale, except when the integer scale would waste more than 20% of the available fit (e.g. Pixel 7 portrait at dpr 2.6). Then it uses a fractional nearest-neighbour scale. This is a small deviation from strictly integer scaling, chosen so phones don't lose a quarter of the screen.
- CRT: WebGL pass (barrel warp mirrored on the CPU for hitTest, scanlines, aperture grille, radial chromatic aberration, 8-tap bloom, vignette, grain/flicker). FxFrame.crtPulse boosts it. Reduced motion freezes time and zeroes grain and pulse. setCrt({enabled:false}) is a plain nearest blit. Without WebGL it falls back to a 2D-canvas blit.
- Render draws FX ghost cards from CardId, honours opacity 0 (held-back cards), and adds held-back room cards back onto the displayed deck count so it doesn't drop before the deal lands. Popup x/y are the text centre.

app
- The app owns Settings persistence. It creates the audio engine with { persist: false } and pushes volumes/mute into it, so there is one writer. It subscribes to the session before newGame (the opening deal animates). Card hovers go to fx.setHover. If createFxDirector or createAudioEngine throws, it uses a neutral FX director or silent audio (src/ui/fallbacks.ts).

### 2026-11-20: Review gate: APPROVE rules-tests (tests/unit, revised by Gaeta after the REJECT of Tigh's suite). Committed src/game + tests as bfdae0a.
**By:** Adama
**Recorded:** 2026-11-20T17-21-09
**References:** Gaeta, Tigh, Tyrol, tests/unit/scoring.test.ts, tests/unit/fuzz.test.ts, rules-tests
**Status:** Supersedes the REJECT of 2026-11-20T17-15-01 on the same subject (rules-tests).
**Why:** Verdict: APPROVE. Lockout: `node .squad/squad.mjs lockout approve rules-tests --reviewer adama` returned "rules-tests: cleared". Commit bfdae0ade81a34e4816d16bbeac1a0cdd4f5e25e contains only src/game and tests ("Implement Scoundrel rules engine and rules test suite").

Both required changes from the earlier REJECT are verified.
1. Death on room completion.
   - tests/unit/scoring.test.ts has a new nested describe that kills the player on the 3rd card of a non-final room, both barehanded and with a weapon (D3 with slain [C11], against S9). The shared expectDeathFroze helper asserts:
     - the events are exactly [MonsterFought, DamageTaken, GameLost];
     - the leftover H4 stays in slot 2;
     - roomNumber and deck are unchanged;
     - the killer is appended to the discard;
     - the score is -14.
   - The weapon case asserts that the weapon and slain stack are unchanged.
   - The final-room death test asserts the exact events, an empty room and discard [S9].
   - In the fuzz test, playOut checks every losing batch: no MonsterSlain, RoomCleared, CardDealt or RoomRevealed, and GameLost last.
2. Fuzz timeouts. FUZZ_TIMEOUT_MS = 30_000 is set on all 6 fuzz tests, and SEARCH_SEEDS = 100. Under the full parallel npm test, each fuzz test now takes 0.32 to 0.63s (previously 3.5 to 4.5s).

No weakening. `git diff --no-index` against my pre-REJECT snapshot shows only additions, plus the agreed search seed cut from 300 to 100. That tier still asserts that a final room is reached and that every final room holds exactly 2 cards.

Mutation results (tests/unit, 146 tests):
- Gaeta's mutant (RoomCleared before GameLost) fails 9.
- Independent reviewer mutants:
  - MonsterSlain before GameLost fails 10;
  - the killer pushed onto weapon.slain fails 5;
  - the killer not discarded fails 9;
  - a card dealt after death fails 2;
  - leftover cards swept to the discard fails 2.
- The clean engine passes 146/146.

Gates:
- npm run typecheck exits 0.
- npm test passes 194/194 across 14 files. The total includes other agents' colocated tests.
- npm run test:e2e passes 2/2.
- No failures came from in-progress fx, render or ui files.

### 2026-11-20: Review gate: REJECT Starbuck's renderer/UI shell (src/render, src/ui, src/main.ts) for a broken 2D fallback on GL init failure and rule logic in render; accept presentation contract additions (a)-(d); keep the live HUD score (e)
**By:** Adama
**Recorded:** 2026-11-20T17-21-25
**References:** Starbuck, Gaeta, Tyrol, src/render/crt.ts, src/render/renderer.ts, src/ui/view.ts, src/ui/app.ts
**Status:** The REJECT verdict is SUPERSEDED by the APPROVE of 2026-11-20T17-34-35 (Tyrol's revision, commit 4315d44). Rulings (a)-(e) remain binding.
**Why:** Verdict: REJECT. typecheck passes, build passes (78.4 kB JS, 28.4 kB gzip), npm test 194/194, e2e 2/2. The lockout applies to src/render and src/ui: a different agent revises them.

Required changes:
1. 2D fallback breaks on WebGL init failure (src/render/crt.ts:125-169, src/render/renderer.ts:665-671). createCrtPass claims the display canvas with getContext('webgl') before compiling the shaders. If compile or link fails it returns null, and the renderer's getContext('2d') on that same canvas then returns null, so nothing ever draws: a black screen with no error. I reproduced this by forcing COMPILE_STATUS false (the screenshot is 2.6 kB and entirely black). Without WebGL at all, the fallback works. This breaks the brief and ARCHITECTURE ("2D fallback"). Fix: compile and link on a throwaway probe canvas first, and claim the display canvas for WebGL only once the probe succeeds (or present through a separate canvas element). Add a probe or e2e check that a forced shader failure still renders.
2. Rule logic in render (src/render/renderer.ts:491-493, 457, 459). hintText hard-codes the resolve-3-per-room rule (3 - resolvedThisRoom, capped by cards in the room). The tooltip decides LETHAL by comparing damage with hp. It also branches HEAL or EQUIP by mapping the suit through artKind. This breaks the brief ("Render applies NO game rules; selectView precomputes affordances") and Starbuck's own decision ("UI uses damageBarehanded instead of re-deriving kind"). Fix: selectView precomputes them as additive fields, GameView.cardsLeftToResolve (from CARDS_RESOLVED_PER_ROOM and engine state, final room included), RoomCardView.kind (via cardKind) and RoomCardView.lethal. Render reads only those. artKind stays for choosing artwork only.

Contract rulings (binding):
(a) ACCEPTED as additive: the new ButtonIds (crt, motion, volDown, volUp, closeMenu) and UiIntents (closeSettings, toggleCrt, toggleReducedMotion, changeVolume, skip); GameView.resolvedThisRoom and GameView.chrome (ViewChrome); and selectView(null) or screen 'title' returning the title view. The fields in required change 2 are pre-approved additions.
(b) ACCEPTED: LOGICAL_WIDTH/HEIGHT live in render/theme.ts and are re-exported from render/types.ts, with the same names and values. Portrait is 270x480.
(c) ACCEPTED as an amendment to "integer-upscaled". Scaling is integer by device pixel unless that would waste more than 20% of the fit, in which case it is fractional nearest-neighbour. Measured: 1280x720@1 gives 2.67x (fractional), 1920x1080 gives 4x, 1440x900@2 gives 6x, and Pixel 7 portrait gives 4x. Integer-only would waste about 44% of a 1280x720 screen. The 20% threshold is now the rule.
(d) ACCEPTED: one Settings writer. ui/app persists, and createAudioEngine({ persist: false }) receives its volumes and mute from the app. Audio's own persistence path stays for the no-argument DR1 behaviour.
(e) KEEP the live HUD score as computeScore mid-game (hp - remaining monsters, about -188 at the start). It is the engine's score, it rises as monsters die, and it equals the loss score at hp 0. No relabel or hiding required.

Brief items verified: the session is subscribed before newGame. The app has no replay or load path, so "fx.skip() after replay/load" does not apply yet. Once one is added, it must call fx.skip(). reducedMotion reaches fx, and the title and game frames are pixel-identical under prefers-reduced-motion. Audio unlocks on the first pointer or key. onCue goes to audio.handleEvent. setHover is forwarded. Game actions are gated while busy, and a tap skips. Game keys do nothing while the menu is open. A throwing localStorage still boots and plays. The hitTest warp mirrors the shader exactly. FX ghost cards are drawn from their CardId, opacity 0 is honoured, faceUp below 0.5 draws the back, and fx.cards is always applied.

### 2026-11-20: Re-review fx-director: APPROVE Tyrol's revision of src/fx/director.ts; committed src/fx + src/audio as 2f43308
**By:** Adama
**Recorded:** 2026-11-20T17-22-41
**References:** gaeta, tyrol, fx-director, src/fx/director.ts, src/fx/director.frames.test.ts
**Status:** Supersedes the REJECT verdict of 2026-11-20T17-13-52 on the same subject (fx-director). That entry's contract ruling still stands.
**Why:** Verdict: APPROVE (re-review of fx-director; original author Gaeta, revision by Tyrol under lockout).

All three required fixes are verified at frame level:
(1) Deal/reveal hand-off: RoomRevealed precomputes each card's land time (modelDealLand / modelClock). A card follows dealPose until it lands. Its flip starts at max(i*60, land), and the step duration is extended to match. The probe shows C3 travelling continuously, then flipping only after landing.
(2) Equip ghosts: the replaced weapon is deduped (WeaponEquipped.discarded already contains it). The exit stagger is compressed to min(30, (460-32-260)/(n-1)). With an 8-card stack plus the old weapon, all 9 ghosts reach opacity 0 before release.
(3) GameLost: cards without a layout home fly to the discard and fade to 0 between 100 and 800 ms. Homed cards keep the 0.45 defeat pose. The killing monster now fades out instead of popping.

Regression tests (src/fx/director.frames.test.ts, 15 tests): reviewer mutants that reverted each fix in a scratch copy made the matching tests fail. Reverting fix 1 failed 4 tests, fix 2 failed 4, and fix 3 failed 2. The unmutated copy passed 26/26 FX tests.

Invariants verified by a scratch probe:
- Cue indices arrive in event order for 19/19 events at dt 7, 16 and 33.
- Frames are identical across two runs at the same dt.
- End state matches across dt values and skip().
- Reduced motion and skip() fire every cue and leave the director idle.
- No dealt card freezes mid-chain (deal batch after a fight, potion and RoomCleared with a carried card).
- No public types changed: src/fx/types.ts and src/audio/types.ts predate the revision, and director exports are unchanged.

Commands: typecheck clean; npm test 194/194; build clean.
Lockout: `squad lockout approve fx-director --reviewer adama`, output "fx-director: cleared".
Commit 2f43308 "Add FX director and procedural audio engine" covers only src/fx and src/audio (audio was approved in the first review). It depends only on the LayoutSnapshot/Rect types in src/ui/view.ts, and those are unchanged from HEAD.

### 2026-11-20: User directive: Scoundrel must ship with an interactive tutorial that teaches the game
**By:** Jonny Bowen (user directive, via Squad)
**Recorded:** 2026-11-20T17-31-31
**Why:** User directive (2026-11-20): "please ensure there is an interactive tutorial to teach the game". The game must include an interactive tutorial (learn-by-doing, not a static rules page) that teaches Scoundrel's rules: monsters/weapons/potions, rooms (play 3 leave 1), avoiding (not twice in a row), weapon degradation, one potion per room, winning/losing and scoring. It is a ship requirement; reviewers treat its absence or gaps against this as a REJECT. Design via Design Review (Adama facilitates), then implementation by owners per routing.

### 2026-11-20: Review gate: APPROVE render-ui (src/render, src/ui, src/main.ts, revised by Tyrol after the REJECT of Starbuck's version). Committed as 4315d44.
**By:** Adama
**Recorded:** 2026-11-20T17-34-35
**References:** Tyrol, Starbuck, Tigh, src/render/crt.ts, src/render/renderer.ts, src/ui/view.ts, src/ui/app.ts
**Status:** Supersedes the REJECT of 2026-11-20T17-21-25 on the same subject (render-ui). That entry's rulings (a)-(e) still stand.
**Why:** Verdict: APPROVE. Lockout render-ui cleared. typecheck exits 0. build is 79.23 kB JS, 28.70 kB gzip. npm test passes 194/194. e2e passes 2/2.

Required change 1, the 2D fallback: met. The display canvas only ever gets a 2D context. crt.ts renders on its own detached WebGL canvas, and the renderer copies that canvas onto the display or does a nearest-neighbour blit. My probe instrumented every getContext call: the display canvas got no webgl request in any scenario. Under each forced failure the title and the game frames are lit (60-97% of sampled pixels) with no page errors. The failures were fragment-shader compile only, link failure, createProgram returning null, and getContext('webgl') throwing. On a real context loss the game stays lit, and after restore the CRT image comes back. hitTest warps only while the CRT is active. The probe uses a point that hits only when warped and a point that hits only when unwarped. Each behaves as expected with the CRT on, toggled off, under every failure, while the context is lost, and after restore.

Ruling on where the check lives: the scratch probe meets my requirement. My REJECT asked for "a probe or e2e check", and the fix is structural (the display canvas never asks for WebGL). Moving the check into tests/e2e is a recommended follow-up for Tigh, not a gate condition.

Required change 2, no rules in render: met. selectView supplies cardsLeftToResolve (from CARDS_RESOLVED_PER_ROOM, or every card in the final room when deck.length is 0, which matches engine isFinalRoom), RoomCardView.kind (cardKind) and RoomCardView.lethal (the cheapest available option is at least hp, false after game over). The renderer branches only on those fields. artKind is used only in cardArt for artwork. I grepped src/render and src/ui for other rule derivation and found none. The rank shown on cards and tooltips and the HP colour bands are presentation only.

Regressions: none found. The viewport scaling, reduced-motion freeze, localStorage-throwing, Pixel 7 portrait and menu probes from the first review all behave as before. Tyrol's scratch view tests (6) and his fallback probe pass.

Advisories (not required): (a) Copying the WebGL canvas into the 2D context causes a "GPU stall due to ReadPixels" driver warning in headless Chromium, so measure frame time on real low-end hardware. If it is costly, stack a visible WebGL canvas over the 2D one and hide it on failure. (b) The potion tooltip says "HEAL <rank>" even when healing would be capped at max HP. selectView could expose the actual heal amount.

### 2026-11-20: Design Review 2: interactive tutorial. A scripted real-engine dungeon, a pure src/tutorial step machine with a gate, and additive optional contracts in ui/fx/audio/settings and the engine's createGame({ deck })
**By:** Adama
**Recorded:** 2026-11-20T17-49-07
**References:** Tyrol, Starbuck, Gaeta, Tigh, docs/TUTORIAL.md, jonny-bowen-user-directive (interactive tutorial)
**Why:** Answers the user directive "please ensure there is an interactive tutorial to teach the game". docs/TUTORIAL.md is the source of truth for the script, the gates and the ownership.

Design:
- Learn by doing on the real board. A scripted 14-card dungeon, top first: D5 S8 C3 H5 | S14 C7 H10 | S6 C9 C4 H4 | D10 H2 C2. It runs 6 rooms in 30 steps across 7 lessons: cards, rooms, avoiding, dulling, potions, stakes, final room. Verified against the real engine: HP after each room is 20, 20, 10, 14, 10, 20, ending in GameWon with score 30 (20 HP + 10 potion bonus). The avoided room 2 returns as rooms 5-6. Room 3 has the player press AVOID, and the engine refuses it (cannotAvoidTwice). In room 3 the 9 is over the weapon limit of 6. In room 4 the H2 is wasted. Room 5 explains losing, and the gate refuses a lethal barehanded Ace. The script also works under weaponLimit 'lt'.
- The engine stays the only rules authority. The tutorial (1) chooses the deck through the new additive NewGameOptions.deck (unshuffled, no RNG call, RangeError on an empty deck or duplicate ids), (2) narrows legal moves with gate() (blocked moves never reach the engine: a gentle nudge plus a coachBlip, no toast, no HP cost), and (3) advances on engine events or violations. There are no rule forks.
- src/tutorial is pure and imports only src/game. It is added to the tsconfig.game.json purity gate.
- FX timing: the coach chrome is latched while fx.isBusy(). New text and the success cue appear when FX goes idle. tutorialNext is gated like game actions (busy -> fx.skip()). Tutorial FX never extend isBusy.
- Entry: a TUTORIAL button on the title (key T), plus a modal first-launch offer while Settings.tutorialSeen is false. It becomes true on accept, decline, start, leave or recap; the app is the single writer. Leave with SKIP or X, or LEAVE TUTORIAL in settings (no confirmation). N is ignored in the tutorial. The recap offers PLAY A REAL RUN (Enter) and REPLAY (R).
- Accessibility and e2e hook: a visually hidden #coach-live aria-live region with data-step, data-page, data-phase and data-ready.

Contracts committed as stubs, all optional or additive so the running app is unchanged:
- src/tutorial/{types,machine,script,index}.ts
- NewGameOptions.deck
- ui/view.ts: ButtonIds tutorial, tutorialAccept, tutorialDecline, tutorialNext, tutorialSkip, tutorialPlayReal, tutorialReplay; UiIntents tutorialStart, tutorialNext, tutorialSkip, tutorialDecline, tutorialPlayReal; optional ViewChrome/UiLocalState tutorial and tutorialOffer; optional LayoutSnapshot regions and coach
- Settings.tutorialSeen
- ui/tutorialController.ts
- render/coach.ts
- FxFrame.coach (CoachFx), FxDirector.tutorialCue?, TutorialFxCue, fx/coach.ts
- audio TutorialSfxId (coachBlip, stepSuccess, tutorialComplete), which Gaeta merges into SfxId with the synth voices

Ownership:
- Tyrol: machine.ts, script.ts and the engine deck option.
- Starbuck: tutorialController.ts, app.ts integration (OWNER of the integration point, 5 hook sites), input.ts, view.ts, settings.ts, render/coach.ts, layout.ts, renderer.ts, index.html.
- Gaeta: fx/coach.ts, director.ts tutorialCue, synth voices and the SfxId merge.
- Tigh: tests/unit/tutorial.test.ts, tests/unit/deckOption.test.ts, tests/e2e/tutorial.spec.ts (full keyboard playthrough, desktop and Pixel 7, plus reduced motion), and an update to smoke.spec.ts for the offer.

Review gate: any build without the tutorial, or where it fails to teach one of the directive's concepts, is REJECTED.

### 2026-11-20: User directive: confirmed tutorial design choices; requested resume-on-reload
**By:** Jonny Bowen (user directive, via Squad)
**Recorded:** 2026-11-20T17-53-18
**Why:** User answers (2026-11-20):
1. Tutorial: the first-launch offer is a modal on the title screen (TEACH ME / I KNOW THE RULES), remembered after it's answered. Confirmed.
2. Tutorial: keep the scripted wasted second potion in room 4. Confirmed.
3. Tutorial: keep about 30 steps. Confirmed.
Adama's two other questions stay at his defaults: leaving needs no confirmation, and the recap doesn't mention rule variants.

New requirement: an active run must survive a page reload. Save the seed, the rules and the action history after each action, and on load replay them to restore the run, with the FX skipped, instead of returning to the title. Use session.replay, which is all-or-nothing and throws on an illegal log, so wrap it in try/catch and fall back to the title. A finished run clears the save. The tutorial isn't saved. This is scheduled after the tutorial wiring lands, to avoid app.ts conflicts.

### 2026-11-20: Tutorial machine: interpretations of the DR2 contract (no type changes; one additive export, DESYNC_TEXT)
**By:** Tyrol
**Recorded:** 2026-11-20T17-56-07
**References:** Starbuck, Tigh, Adama, docs/TUTORIAL.md, src/tutorial/machine.ts
**Status:** Proposed by Tyrol; interpretations 1-7 ACCEPTED by Adama's review gate (2026-11-20T20-55-07).
**Why:** src/tutorial/types.ts is unchanged. The machine (src/tutorial/machine.ts) fixes these points the spec left open. They matter to Starbuck (controller) and Tigh (tests):

1. Recap: when the GameWon batch completes r6Potion, phase becomes 'recap' and stepIndex STAYS at 29 (the last step) rather than 30, so currentStep() is total. tutorialChrome().recap takes score and scoreText from the engine's final GameState ("20 HP + 10 POTION BONUS", 30). tutorialRecap() returns the same static text.
2. Desynced: advance() is a no-op for 'next', 'events' and 'violation' in 'recap' and 'desynced'. Restarting is the controller's job: on NEXT while chrome.phase === 'desynced', call session.newGame(tutorialGameOptions()) and startTutorial(). The coach text is the exported DESYNC_TEXT, with showNext true and an empty spotlight. 'blocked' still records the nudge in every phase.
3. Gate nudges in terminal phases: recap -> "THE TUTORIAL IS DONE. PRESS ENTER FOR A REAL RUN.", desynced -> DESYNC_TEXT.
4. Sync check: after a completion with state, the machine checks the expected card of the new step, OR of the next action step if the new step is an info step. NEXT carries no state and the game cannot change during info steps, so this is the only place to catch it. This is a superset of the documented rule.
5. Gate rule 6 belt and braces: an expected move is also run through engine step() (a select checks the card is in the room). If the engine would refuse it, the gate blocks it with the step nudge. The exception is a step whose trigger is a violation (r3TryAvoid). This never fires with the scripted deck.
6. Specific-nudge matchers with a mode never match a 'select' query. Matchers without a mode match any mode and select, per the spec.
7. createGame({ deck }) copies the deck, throws RangeError on an empty deck or duplicate ids, and never creates the RNG (rngFactory is not even called).

### 2026-11-20: Review gate: APPROVE Gaeta's tutorial FX and audio for Design Review 2 (src/fx/coach.ts, director.ts tutorialCue, synth tutorial voices, SfxId merge, and three test files)
**By:** Adama
**Recorded:** 2026-11-20T17-56-17
**References:** Gaeta, Starbuck, Tyrol, Tigh, docs/TUTORIAL.md, src/fx/coach.ts, src/fx/director.ts, src/audio/synth.ts, src/audio/types.ts
**Why:** Verdict: APPROVE (Design Review 2 slice: tutorial FX and audio, author Gaeta). No required changes.

In scope: src/fx/coach.ts, src/fx/director.ts (tutorialCue hook), src/audio/synth.ts, src/audio/types.ts, src/fx/coach.test.ts, src/fx/director.coach.test.ts, src/audio/synth.test.ts.

Checked against docs/TUTORIAL.md (FX timing, Reduced motion, Audio and FX cues), the DR2 decision, the user directive and confirmations, docs/ARCHITECTURE.md and the fx-director decisions:
- Never blocks: the CoachFxTrack is separate from the queue. tutorialCue doesn't enqueue, emit FxCue or touch isBusy(). director.coach.test spams cues during a deal batch, and the per-frame busy flags, cue frames and card frames all match a plain run.
- Reduced motion: the director forwards setReducedMotion to the track. Values are COACH_STATIC (pulse 0.5, everything else 0) whatever the cues, and toggling mid-animation cancels it. Sounds are app-side and aren't gated by reduced motion.
- Deterministic and pure: every value is a closed-form function of elapsed time per cue. Tests show one big dt equals 20 small ones. There's no DOM, timer or randomness, and bad dt is ignored.
- Audio: coachBlip (soft, peak under uiClick, two rising sine/triangle notes), stepSuccess (rising triangle chime) and tutorialComplete (pickup into a chord, shorter than win). The diff to synth.ts is purely additive, so no existing voice changes. TutorialSfxId is merged into SfxId, and the pitch 0.8 nudge scales correctly.
- Director diff: only additive hooks plus withCoach wrapping on the frame build and skip paths. src/fx/director.frames.test.ts is unmodified and passes 15/15. My earlier fxrev probes give the same trace output on the working tree as on a HEAD copy of src.

Commands: npm run typecheck exits 0. npm test passes 18 files and 239 tests. vite build to the scratchpad succeeds; Tyrol's machine.ts now typechecks.

Advisories (not blocking):
1. director.ts:222/311: coachOn never resets, so after the player leaves the tutorial, FxFrame.coach stays present (and animating) in real runs. The comment at 221 says normal play frames are unchanged. Render must gate drawing on chrome.tutorial, not on fx.coach presence (Starbuck). Gaeta could optionally add a reset path later.
2. render/coach.ts:9 (DR2 stub doc, Starbuck) says reduced motion means "pulse 0". The contract and implementation use 0.5 for the static ring. Starbuck should treat 0.5 as the static ring and fix the comment.
3. coach.ts:81: cues during reduced motion are dropped, so turning reduced motion off afterwards shows no pending bump. This is acceptable.
4. The audio RETRIGGER_S of 30 ms dedupes the same id. Nudge then coachShown within 30 ms would drop one coachBlip. This is unlikely given the latch.

### 2026-11-20: Review gate: REJECT Tyrol's tutorial logic (DR2): a GameWon batch on a non-matching step leaves the machine stuck in coaching
**By:** Adama
**Recorded:** 2026-11-20T20-55-07
**References:** Tyrol, Tigh, Starbuck, docs/TUTORIAL.md, src/tutorial/machine.ts, src/game/engine.ts
**Status:** The REJECT verdict is SUPERSEDED by the APPROVE of 2026-11-20T21-01-17 (Gaeta's revision). The rulings on Tyrol's interpretations below remain binding.
**Why:** Scope: the src/game/engine.ts deck option, plus src/tutorial/script.ts, machine.ts, machine.test.ts and index.ts.

VERDICT: REJECT, for one required change.

R1. src/tutorial/machine.ts:222-233 (advance, case 'events'). docs/TUTORIAL.md "Advance rules" says that a GameWon batch moves the machine to recap. The implementation goes to recap only when the current step's trigger also hits. A probe fed a GameWon batch on r6Two and got phase 'coaching' with the step still r6Two. The game is won, so every move is refused, and NEXT is a no-op on an action step. The player is stuck, the only exit is SKIP, and no desync fires.
- Requirement: any batch containing GameWon sets phase 'recap', with stepIndex on the last step, page 0 and the nudge cleared, whether or not the trigger hit. The GameLost check stays first.
- Make the header comment at machine.ts:31-32 say the same.
- Add a regression test to machine.test.ts: a GameWon batch on a non-final step (e.g. r6Two) results in phase 'recap'.
The case is unreachable under the gate. It is still a gap against the normative rule and a stuck state, and the spec handles the equivalent GameLost case defensively.

Rulings on Tyrol's interpretations (tyrol-tutorial-machine-interpretations):
1. Recap keeps stepIndex on the last step, and the score comes from the engine state: ACCEPTED.
2. Terminal phases are no-ops, the controller restarts from desynced, and DESYNC_TEXT is exported: ACCEPTED. The DESYNC_TEXT export is additive.
3. Terminal-phase gate nudges, including the RECAP_NUDGE text: ACCEPTED. The text passes the glyph rule.
4. The wider sync check, which looks ahead through info steps to the next action step: ACCEPTED, as a strict superset of the spec. It is the only point where the game state is available before NEXT-only steps.
5. Rule 6 belt and braces (engine step() pre-check, with the violation-trigger exception): ACCEPTED. It calls the pure engine and never re-implements a rule. See advisory A1.
6. Matchers with a mode never match select: ACCEPTED. This follows from the spec wording.
7. The deck option copies the deck, throws RangeError on an empty deck or duplicate ids, and never creates the RNG: ACCEPTED. The default path is unchanged; I compared the seed-7 deck with and without deck: undefined.

Checks:
- The script text matches docs/TUTORIAL.md. A mechanical cross-check of all 76 strings found no difference.
- All 30 steps, spotlights, expects, triggers and specific nudges match.
- Every required concept is exercised.
- There are no rule forks in src/tutorial.
- The purity gate passes.
- The gate blocks without dispatching.

Advisories:
- A1. An expected move that the engine refuses is blocked with the step nudge forever, and nothing moves to desynced. That is also a stuck state. Consider treating it as a desync in a future revision.
- A2. scriptedDeck does not check that a card is well formed. {id:'S8', rank:99} was accepted. The spec only requires non-empty and unique.
- A3. The 2-card deck path works: a partial first room with null slots.

Commands:
- tsc -p tsconfig.game.json: passes.
- npm test: 321/321 pass.
- npm run typecheck and npm run build fail. The only errors are in tests/unit/tutorial.test.ts (Tigh, in progress): node:fs and node:url types, and an implicit any at line 166. They are not Tyrol's. `vite build` on its own succeeds.

### 2026-11-20: User directive: port Scoundrel to Android after the tutorial is complete; target device: Samsung Galaxy S22+
**By:** Jonny Bowen (user directive, via Squad)
**Recorded:** 2026-11-20T20-56-13
**Why:** User directive (2026-11-20): "when complete, port this to android. there's an s22+ plugged in". This starts after the tutorial batch has been approved and committed. Owner: Adama (build & deploy). Environment check by the coordinator: the Android SDK is at %LOCALAPPDATA%\Android\Sdk (platforms 34–37, build-tools up to 37.0.0, platform-tools); a JDK is available as the Android Studio JBR at C:\Program Files\Android\Android Studio\jbr; adb and java are NOT on PATH and ANDROID_HOME/JAVA_HOME are unset. The device RFCT80BSTVX is connected but currently "unauthorized": the user must accept the USB-debugging RSA prompt on the phone. Likely approach (Adama to confirm in design): wrap the static Vite build in a native Android shell (e.g. Capacitor), with landscape+portrait, immersive fullscreen, audio unlock on first touch, back-button handling, and keep-awake optional, then build a debug APK and install it with adb.

### 2026-11-20: Review gate: APPROVE tutorial-machine (Gaeta's revision): R1 is resolved, a GameWon batch always goes to recap
**By:** Adama
**Recorded:** 2026-11-20T21-01-17
**References:** gaeta, tyrol, tutorial-machine, DR2
**Status:** Supersedes the REJECT of 2026-11-20T20-55-07 on the same subject (tutorial-machine). That entry's rulings on Tyrol's interpretations still stand.
**Why:** Re-review of tutorial-machine after the REJECT of Tyrol's version (R1).

Verified:
- In src/tutorial/machine.ts advance()'s 'events' branch, GameLost is checked first and leads to desynced. Next, any batch containing GameWon returns {phase:'recap', stepIndex: last, page:0, nudge:null}, whatever the current step's trigger is and whether or not it matched. A diff against the unfixed scratch copy shows that the only code change is that this block moved above the trigger-kind and hit checks (apart from import paths in the scratch copy). No other behaviour changed.
- The header comment's Advance rules now describe the GameWon-to-recap rule.
- The regression test describe('recap') in src/tutorial/machine.test.ts covers r6Two with a stale nudge and a GameWon-only batch, and checks the exact recap state with nudgeSerial kept. Gaeta showed that it fails against the unfixed copy.
- Reviewer probe (3/3) passes, `npx tsc -p tsconfig.game.json` is clean, `npm run typecheck` is clean, and `npm test` passes 322/322.

Non-blocking nit: the new inline comment "stay in 'coaching' and the player is stuck" reads better as "otherwise we would stay in 'coaching' and the player would be stuck".

The lockout is cleared (`lockout approve tutorial-machine --reviewer adama`). The tutorial will be committed as one batch later.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
