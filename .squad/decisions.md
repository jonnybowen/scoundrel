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
**Status:** Proposed by Starbuck; ruled on by Adama's review gate (2026-11-20T17-21-25). Accepted: the ButtonId/UiIntent/GameView/selectView additions, LOGICAL_WIDTH/HEIGHT location, the 20% fractional-upscale rule, and the single Settings writer. SUPERSEDED in part: render must no longer flag LETHAL itself (or derive hint counts or HEAL/EQUIP); selectView must precompute GameView.cardsLeftToResolve, RoomCardView.kind and RoomCardView.lethal instead. The upscale rule and the fixed 480x270 / 270x480 logical size are AMENDED by the fullscreen-layout decisions of 2026-11-21 (Tyrol's revision 2026-11-21T16-55-51, approved 2026-11-21T17-01-16): 20% applies at dpr < 2, 5% at dpr >= 2, and the long axis is viewport-dependent.
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
**Status:** The REJECT verdict is SUPERSEDED by the APPROVE of 2026-11-20T17-34-35 (Tyrol's revision, commit 4315d44). Rulings (a)-(e) remain binding, except that ruling (c) is AMENDED by the fullscreen-layout revision (2026-11-21T16-55-51, approved 2026-11-21T17-01-16): the 20% threshold applies at dpr < 2 and a 5% threshold at dpr >= 2.
**Why:** Verdict: REJECT. typecheck passes, build passes (78.4 kB JS, 28.4 kB gzip), npm test 194/194, e2e 2/2. The lockout applies to src/render and src/ui: a different agent revises them.

Required changes:
1. 2D fallback breaks on WebGL init failure (src/render/crt.ts:125-169, src/render/renderer.ts:665-671). createCrtPass claims the display canvas with getContext('webgl') before compiling the shaders. If compile or link fails it returns null, and the renderer's getContext('2d') on that same canvas then returns null, so nothing ever draws: a black screen with no error. I reproduced this by forcing COMPILE_STATUS false (the screenshot is 2.6 kB and entirely black). Without WebGL at all, the fallback works. This breaks the brief and ARCHITECTURE ("2D fallback"). Fix: compile and link on a throwaway probe canvas first, and claim the display canvas for WebGL only once the probe succeeds (or present through a separate canvas element). Add a probe or e2e check that a forced shader failure still renders.
2. Rule logic in render (src/render/renderer.ts:491-493, 457, 459). hintText hard-codes the resolve-3-per-room rule (3 - resolvedThisRoom, capped by cards in the room). The tooltip decides LETHAL by comparing damage with hp. It also branches HEAL or EQUIP by mapping the suit through artKind. This breaks the brief ("Render applies NO game rules; selectView precomputes affordances") and Starbuck's own decision ("UI uses damageBarehanded instead of re-deriving kind"). Fix: selectView precomputes them as additive fields, GameView.cardsLeftToResolve (from CARDS_RESOLVED_PER_ROOM and engine state, final room included), RoomCardView.kind (via cardKind) and RoomCardView.lethal. Render reads only those.  artKind stays for choosing artwork only.

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

### 2026-11-20: Review gate: REJECT tutorial-ui (Starbuck). #coach-live reports data-ready="true" while the latched chrome of the step just completed is still mirrored, which breaks the DR2 hook contract
**By:** Adama
**Recorded:** 2026-11-20T21-24-50
**References:** Starbuck, Tigh, Gaeta, docs/TUTORIAL.md, src/ui/app.ts, tutorial-ui
**Status:** The REJECT verdict is SUPERSEDED by the APPROVE re-review of 2026-11-20T21-58-26 (Gaeta, Tyrol's revision; fix recorded in Tyrol's decision 2026-11-20T21-36-12).
**Why:** Verdict: REJECT. No commit. Reviewer lockout: the revision goes to an agent other than Starbuck.

Gap (DR2, docs/TUTORIAL.md:244): data-ready must be "true when FX is idle and the chrome is not latched". In src/ui/app.ts the frame loop calls refresh(), which calls tutorial.chrome(fx.isBusy()) at :292, so it gets the latched chrome while FX is busy. It then calls fx.update at :552 and mirrorCoach at :554. mirrorCoach computes ready = !fx.isBusy() at :511 after the update. On the frame where FX finishes, the mirror shows the latched chrome of the step that was just completed, with data-ready="true". Measured with a MutationObserver probe (desktop, normal motion): r1Equip:0:true held for 127 ms after the equip FX, before r1Fight:0:true; r1Fight:0:true for 216 ms; r1Potion:0:true for 158 ms. This is exactly the signature the hook contract tells consumers to wait on ("ready on step X, now send X's key"). The current e2e doesn't trip it, only because every canonical FX-producing move changes the step id.

Clearing conditions:
1. data-ready is derived from the chrome actually mirrored. It is true only when that frame's chrome() call returned live chrome (not latched) AND FX is idle. For example, capture busy-at-refresh and set ready = !busyAtRefresh && !fx.isBusy(), or expose a latched flag from TutorialController.
2. A regression check that fails on the current code. For example, an e2e MutationObserver sequence assertion: after an action step's key, no (step=<that step>, ready=true) record appears once ready has gone false. Or an equivalent unit test of the mirror/controller.
3. typecheck, vitest and the full Playwright run stay green.

Everything else in the subject passes: the offer modal (TEACH ME / I KNOW THE RULES), tutorialSeen persisted only through updateSettings (single writer), the title TUTORIAL button and key T, X / SKIP / LEAVE TUTORIAL with no confirmation, N ignored, the recap Enter/R/Esc, render gating on chrome.tutorial (renderer.ts and coach.ts activeCoach), no rules in render, and the 2D-only display. The reduced-motion probe gave byte-identical screenshots 700 ms apart on the offer, the coach info and action steps, the nudge and the menu, on desktop and Pixel 7. A tap on the coach panel counts as NEXT. There were no page errors. My earlier advisory is closed: render/coach.ts:29 STATIC_FX.spotlightPulse = 0.5, used under reducedMotion (:31-33).

Advisories (not required): the landscape coach strip is 8,234,464,33 instead of the doc's ~52 tall (2 text lines). Only r4Wasted plus a nudge replaces line 2, which the CoachView contract allows; update the doc. renderer.ts:23 declares COACH_DRAWN between imports. Restarting from desynced via next() does not fx.skip() or clear pendingFight/toast. tutorialPlayReal reuses opts.seed when one was given. The TutorialController latch and signals have no direct unit tests.

### 2026-11-20: Review gate: APPROVE tutorial-tests (Tigh). Unit tests commit-ready now; e2e files commit together with the revised tutorial-ui
**By:** Adama
**Recorded:** 2026-11-20T21-24-58
**References:** Tigh, Starbuck, docs/TUTORIAL.md, tutorial-tests
**Why:** Verdict: APPROVE.

Coverage against the DR2 test list (docs/TUTORIAL.md "Tests") is complete:
- Script integrity, with the doc parsed and diffed word for word, glyphs checked against the real font, the 138-char and 3x46 wrap limits, and a purity import check.
- The golden playthrough, with HP 20,20,10,14,10,20 and score 30, and also under 'lt'.
- The gate: every query at every step and page, rule 6 cross-checked against step(), specific nudges, the enterRoom rule, and blocked moves leaving history unchanged.
- NEXT semantics, desync, and determinism and purity on deep-frozen states.
- deckOption: RNG spy, order, deckSize, RangeError, replay, plus a golden for the default path.
- view.test: the selectView kind, cardsLeftToResolve and lethal rulings.
- E2E: a full keyboard playthrough on desktop and Pixel 7, plus reduced motion. Also the nudge, N ignored, X leaves, reload with no offer, Esc decline persisted, old-save offer, and the smoke update.

The 2 skips are fallback.spec.ts:183 and :217 (CRT curvature hit-testing) on mobile-chromium. They are justified: the logical probe points belong to the desktop mouse-hover path, and running them again on a touch-emulated device adds no coverage. Advisory: the reason "landscape layout only" is imprecise, because the describe forces 960x540, so say "desktop mouse hover only".

Commit readiness: tests/unit/{tutorial,deckOption,view}.test.ts import only approved code and are commit-ready now. tests/e2e/{tutorial,fallback,util}.ts and smoke.spec.ts exercise the tutorial UI, so commit them with the revised tutorial-ui. They didn't catch the data-ready latch bug, but the DR2 list didn't ask for that check. Its regression check is a clearing condition on tutorial-ui.

Advisories: there are no direct TutorialController tests (latch, stepSucceeded/coachShown/completed signals), and no pointer/tap path in e2e.

### 2026-11-20: #coach-live data-ready is derived from the latch state of the text mirrored that frame (app-side flag, not a controller API)
**By:** Tyrol
**Recorded:** 2026-11-20T21-36-12
**References:** adama, starbuck, tigh, docs/TUTORIAL.md
**Status:** Lockout fix for the tutorial-ui REJECT of 2026-11-20T21-24-50; APPROVED by Gaeta's re-review (2026-11-20T21-58-26).
**Why:** Lockout fix for Adama's tutorial-ui reject (docs/TUTORIAL.md:244). refresh() in src/ui/app.ts now records chromeLatched = fx.isBusy() at the moment it calls tutorial.chrome(chromeLatched). mirrorCoach computes ready = t !== null && !chromeLatched && !fx.isBusy(). So data-ready="true" only appears when the mirrored text came from a live (unlatched) chrome() call and FX is still idle after fx.update. Before this, on the frame FX went idle, the latched text of the finished step was mirrored with ready=true for 127-216 ms. I chose the app-side flag over a TutorialController 'latched' getter: it is the smallest change, it adds no API surface, and it describes exactly the text that was mirrored. Regression: e2e test 'data-ready never flags a finished action step as ready again' in tests/e2e/tutorial.spec.ts, which records (step, ready) with a MutationObserver over r1Equip/r1Fight/r1Potion. It fails on the old code and passes with the fix.

### 2026-11-20: Resume-on-reload save contract: src/ui/save.ts, key 'scoundrel.run.v1', the save always mirrors the current real run or nothing
**By:** Starbuck
**Recorded:** 2026-11-20T21-37-37
**References:** tyrol, adama, gaeta, decisions.md: User directive: confirmed tutorial choices and resume-on-reload
**Status:** Contract and src/ui/save.ts ACCEPTED. Tigh's first review (2026-11-20T21-56-15) required test additions only; the revised tests were APPROVED (2026-11-21T09-55-22), and the app.ts resume wiring was APPROVED (2026-11-21T09-55-28).
**Why:** Contract (owner: Starbuck, src/ui/save.ts):
- Key 'scoundrel.run.v1'. It is separate from Settings, and settings.ts stays the only Settings writer. The record is {version:1, seed, rules (the fully resolved RulesOptions from GameState), actions (session.history)}. Storage is injected (SaveStorage = getItem/setItem/removeItem). browserStorage() returns localStorage or null. Every access is wrapped in try/catch, so a throwing storage never throws out.
- Every write is verified first: it steps the pure engine from (seed, rules, actions) and compares the result with the live state. A record that would not replay exactly is never written; the save is cleared instead. This is how scripted-deck (tutorial) runs are excluded, even though tutorialController.start deals the scripted game BEFORE tutorial.active becomes true, so an isScripted flag alone would save the tutorial deal. attachAutosave verifies incrementally (one step plus a JSON compare per batch).
- The save mirrors the current real run or nothing. Starting the tutorial, or any non-reproducible run on the session, clears it, and so does a finished run (phase won or lost).
- loadRun returns null for an absent, unreadable, corrupt-JSON, wrong-version or wrong-shape record. Unknown keys are stripped.
- restoreRun(session, storage) dry-runs the log on the pure engine, refuses a finished end state, then calls session.replay in try/catch. Any failure clears the save, leaves the session unchanged and silent, and returns {ok:false, reason:'none'|'illegal'|'finished'|'replayThrew'}. On ok the caller MUST call fx.skip() (DR1 note), because replay broadcasts one combined batch.
- Bump RUN_SAVE_VERSION (new key suffix) on any breaking change to the record or to the engine's determinism (shuffle, rules defaults). An old save then loads as null and the player sees the title.

### 2026-11-20: Review gate: REJECT run-save (Starbuck, src/ui/save.ts + tests/unit/save.test.ts). The code is correct, but the tests miss part of the contract (4 realistic mutants survive, including the DR1 throwing-localStorage boot path)
**By:** Tigh
**Recorded:** 2026-11-20T21-56-15
**References:** starbuck, adama, decisions.md: User directive: confirmed tutorial choices and resume-on-reload, DR1
**Status:** The REJECT verdict is SUPERSEDED by the APPROVE re-review of 2026-11-21T09-55-22 (Tyrol's test revision). The advisories below remain open.
**Why:** Verdict: REJECT (tests only. No change to src/ui/save.ts is required).

Code: correct against the directive. The save holds seed, resolved rules and the log. Every write is checked by replay. A finished run clears the save. A scripted (tutorial) deck is never written. Restore does a dry run, then session.replay inside try/catch, and falls back with the save cleared. Every storage access is wrapped. tsc is clean, and 27/27 tests pass.

Mutation run: 15 meaningful mutants, 11 killed. The 4 survivors, each of which a 3-to-6-line probe test kills (verified):
- M13: the try/catch is removed from browserStorage() (save.ts:41-46). The test "browserStorage() never throws, whatever the host provides" is vacuous: Node has no throwing localStorage getter. This is the DR1 "throwing localStorage must still boot" path, so it is a gap against a team decision.
- M4/M5: the seed or rules equality is dropped from the incremental prefix check (save.ts:224-225). After that, a new deal that follows another deal (newGame A then newGame B, or the same seed with different rules) is cleared instead of saved, so a reload right after a deal goes to the title. No test deals twice in a row.
- M3: the sameState compare is skipped on the prefix path (save.ts:238). A scripted deck with the same seed as the previous deal is then saved (a tutorial leak). No test has a matching prefix with a diverging state.
- M12: the isScripted() result is ignored in attachAutosave (save.ts:249). No test sets the flag on a reproducible run.

Clearing conditions (add to tests/unit/save.test.ts. Tests are my domain, so Tigh or any agent other than Starbuck may write them; src needs no change):
1. browserStorage() returns null when globalThis.localStorage is a throwing getter (define it with Object.defineProperty and restore it in finally). Kills M13.
2. Autosave saves after back-to-back deals: newGame(seed 1), newGame(seed 2) gives a save with seed 2; then newGame(seed 2, rules lt) gives a save with weaponLimit 'lt'. Kills M4/M5.
3. Autosave: newGame({seed: TUTORIAL_SEED}) and then newGame(tutorialGameOptions()) leaves no save. Kills M3.
4. Autosave with isScripted() returning true on a seeded (reproducible) game clears the save. Kills M12.
Re-run the mutation set. All 4 must be killed.

Cost: fine. With autosave, each action costs one engine step, an O(n) identity prefix compare, a log slice and one JSON compare of the state, which measured at 0.21 ms max per action. Calling saveRun without `verified` is O(n) per save, so O(n^2) per run: 5.4 ms for a whole 27-action run and 0.5 ms max per save. At about 100 actions that is still a few ms per save. Not a concern. The record is at most about 1 KB.

Advisories (not required):
- A change to the shuffle or the engine without a RUN_SAVE_VERSION bump is caught only when the old log becomes illegal. A log of [] or [enterRoom] would silently restore a different deal. Consider storing a fingerprint of the first room or the deck in the record.
- parseSavedRun rebuilds rules with only the two known keys. A new RulesOptions field breaks the typecheck at save.ts:117, so it cannot be dropped silently. Good.
- A rules-default change is safe because the resolved rules are stored. A save from an older version is cleared, and the player sees the title.

### 2026-11-20: Review gate: tutorial-ui re-review (Tyrol revision): APPROVE
**By:** Gaeta
**Recorded:** 2026-11-20T21-58-26
**References:** tyrol, adama, starbuck, src/ui/app.ts, tests/e2e/tutorial.spec.ts, docs/TUTORIAL.md
**Status:** Supersedes the REJECT of 2026-11-20T21-24-50 on the same subject (tutorial-ui).
**Why:** Quick re-review of Tyrol's revision of tutorial-ui (originally Starbuck's, rejected by Adama).

Condition 1 is met. In frame() (src/ui/app.ts:544-566) the order is refresh(), fx.update, draw, then mirrorCoach(view), all in one try block. refresh() sets chromeLatched = fx.isBusy() (:293) before it calls tutorial.chrome(chromeLatched) (:296), so the flag and the mirrored text always come from the same refresh(). mirrorCoach is called only from frame() and always after that frame's refresh(), so chromeLatched cannot be left over from an earlier frame. The other refresh() callers (handle/resize when lastView is null, :312/:451/:471/:482) only bring the flag up to date with the view they build, and the next frame overwrites it anyway. If refresh() throws, the catch skips mirrorCoach. When the tutorial ends or the screen leaves 'game', t is null, so ready is false and data-ready is not written. The FX-idle term is still checked after fx.update. This matches docs/TUTORIAL.md:244.

Condition 2 is met. The new e2e test 'data-ready never flags a finished action step as ready again' logs every data-step|data-ready transition with a MutationObserver. For r1Equip, r1Fight and r1Potion it asserts that after ready goes false, the step never shows step|true again. That is the exact old-code failure. Tyrol showed it failing on the old code, and I did not repeat the mutation test.

Condition 3 is met. npm run typecheck is clean, and playwright tests/e2e/tutorial.spec.ts --project=desktop-chromium gives 7/7 passed (I re-ran both). I did not re-run vitest because Tyrol reported 349/349 and this change touches only app.ts and the e2e spec.

No changes are required.

### 2026-11-21: Review gate: run-save (re-review): APPROVE
**By:** Tigh
**Recorded:** 2026-11-21T09-55-22
**References:** tyrol, starbuck, src/ui/save.ts, tests/unit/save.test.ts
**Status:** Supersedes the REJECT of 2026-11-20T21-56-15 on the same subject (run-save).
**Why:** Tyrol revised tests/unit/save.test.ts only; src/ui/save.ts unchanged. All four clearing conditions are now covered: (1) a throwing globalThis.localStorage getter installed via defineProperty and restored in finally; (2) back-to-back deals on one session (new seed, then the same seed with rules 'lt'); (3) a TUTORIAL_SEED deal followed by tutorialGameOptions() leaves no save; (4) isScripted() true on a reproducible run clears, and the flag wins. Spot-check on a scratch copy: deleting the rules guard in verify kills 1 test, and dropping sameState from verify kills 2. Both mutants are killed, which matches Tyrol's report. Coordinator: vitest 353/353, typecheck clean.

### 2026-11-21: Review gate: resume-wiring (Starbuck, src/ui/app.ts): APPROVE
**By:** Tigh
**Recorded:** 2026-11-21T09-55-28
**References:** starbuck, src/ui/app.ts, src/ui/save.ts
**Why:** Checked against the directive. Active run survives a reload: attachAutosave is attached in ensureSession, so every batch saves. FX is skipped: fx.skip() runs after restoreRun succeeds, because the subscriber enqueues before skip. Failure falls back to the title: restoreRun clears the save and leaves the session alone, ui stays on 'title', and the outer catch forces 'title'. Finished runs clear and the tutorial isn't saved: the save.ts guards handle this, isScripted is wired to tutorial.active, and the reproducibility check catches the deal-before-active case. Throwing localStorage still boots: browserStorage() returns null and tryResume is wrapped. Specific checks: (a) ensureSession(0) at boot with no save leaves a session, but createSession doesn't broadcast, so nothing is saved. The title view only reads session state when screen==='game', and newGame/startTutorialRun reuse the session with their own seed/deck. No change to the title or to Enter/N. (b) Resume sets screen 'game' and clears menuOpen, pendingFight, showResult, error, hover and tutorial. toast is null at boot. refresh() sets tutorialOffer to false off the title. music('dungeon') stays, because unlock() only switches to title music on the title. (c) When a save exists, the offer is hidden while in the game and comes back on the title if tutorialSeen is still false. That's existing behaviour, and the directive doesn't touch it. Seeded boots (?seed=, e2e) skip resume. mirrorRun attributes are diff-gated and cheap. Non-blocking nit: resume doesn't clear ui.toast explicitly, which is harmless at boot.

### 2026-11-21: Fullscreen layout contract: logical size is viewport-dependent (short side 270, long side 480..660); LayoutSnapshot gains optional logical + safe; Viewport gains optional safeArea; upscale rule is now integer unless it wastes >5%
**By:** Starbuck
**Recorded:** 2026-11-21T16-33-44
**References:** Adama, Gaeta, Tigh
**Status:** Proposed by Starbuck. Adama's review gate REJECTED this version (2026-11-21T16-47-12); Tyrol's revision (2026-11-21T16-55-51) was APPROVED (2026-11-21T17-01-16). Items 2 and 5 stand as written. AMENDED by Tyrol's revision: item 4 (the 5% upscale threshold now applies only at dpr >= 2; dpr < 2 keeps the 20% rule of 2026-11-20 (c)); item 1 (the long axis is additionally capped at the viewport aspect, min(MAX_LONG, round(270 * longDev / shortDev), floor(longDev / scale)), so 16:9 windows stay 480x270 at every dpr); item 3 (the safe box is max(inset, CHROME_EDGE) on the long axis whatever the insets report: 24 top / 8 bottom in portrait, 24 both sides in landscape); and onResize now refreshes the layout.
**Why:** Contract changes (mobile full-screen, Galaxy S22+):
1. Logical resolution is no longer fixed at 480x270. render/screen.ts screenGeometry(viewport) keeps the short side at 270 and sets the long side to floor(deviceLong / scale), clamped to 480 (16:9) through 660 (22:9). Past 22:9 the long axis letterboxes. Squarer than 16:9 letterboxes the short axis. 16:9 viewports are unchanged (480x270, and every frame rect is identical to before). Both Renderer.resize and computeLayout derive geometry from the same Viewport. [Amended: long axis also capped at the viewport aspect; see Tyrol's revision 2026-11-21T16-55-51 item 2.]
2. LayoutSnapshot gains optional `logical: {w,h}` and `safe: Rect` (the safe content box in logical px). Absent means the 16:9 base size and the whole canvas, so hand-built snapshots in the fx tests still work. Render, coach overlays and hitTest read the size from the layout (layout.ts logicalOf/frameOf), not from theme.logicalSize(orientation). That function is now only the base size.
3. Viewport gains optional `safeArea` (CSS px insets). app.ts reads the larger of env(safe-area-inset-*) and Capacitor's injected --safe-area-inset-* variables through a hidden #safe-probe element. A MutationObserver on <html style> re-reads them because Capacitor injects them after load without firing a resize event. Only long-axis insets are applied: top/bottom in portrait, symmetric left/right in landscape so the centre line stays at w/2. The safe box never shrinks below the 480 design length. [Amended: a minimum CHROME_EDGE margin applies regardless of the insets; see Tyrol's revision item 3.]
4. Upscale rule: integer scale unless it would waste more than 5% of the fit (previously 20%). Reason: the long axis now adapts to the scale, so only the short axis can waste space. 5% keeps exact 4x on the S22+ and Pixel 7 (1080 = 4 x 270). A dpr-3 phone (4.37x) now fills the screen instead of showing 8% bars, and nearest-neighbour at dpr 2 or higher hides the uneven pixels. The display canvas is still 2D-only, the CRT warp is in uv space so it does not depend on aspect, and hitTest is unchanged apart from reading the logical size from the layout. [Amended: 5% applies only at dpr >= 2; dpr < 2 keeps 20%. See Tyrol's revision item 1.]
5. Frames are functions of (orientation, logical size, safe box), memoised in layout.frameFor. They gained result, topY, scoreX, hint, toastY, footerY, logoY and showcaseY so the renderer no longer hardcodes those positions.

### 2026-11-21: Review gate: REJECT fullscreen-layout (Starbuck). The aspect-adaptive canvas is accepted in principle, but the 5% upscale rule regresses dpr-1 desktops, hitTest is stale for a frame after resize, and on the S22+ the HUD relies on safe-area insets nobody has verified
**By:** Adama
**Recorded:** 2026-11-21T16-47-12
**References:** Starbuck, Tigh, fullscreen-layout, decisions 2026-11-20 (c) 20% fractional-upscale rule
**Status:** SUPERSEDED by the APPROVE of 2026-11-21T17-01-16 (Tyrol's revision 2026-11-21T16-55-51). All three required changes were met.
**Why:** Verified: typecheck and build pass. npm test 385/385. e2e 48 passed, 4 skipped. With E=0 the frames match the old LANDSCAPE/PORTRAIT constants field by field. On the S22+ the screen is 270x585 / 585x270 at an exact 4x, filling 99.8%. My browser probes passed at S22+ portrait and landscape, 4:3 in both orientations (letterboxed on the short axis), 32:9 (capped at 660, centred), 1600x900@1 and 892x340@2.625, each with the CRT on and off (PLAY, then a room-card tap). A discriminating CRT-warp hitTest probe passed at 19.5:9 in both orientations: a point inside the settings button only when warped hit with the CRT on and missed with it off. Rotating portrait, then landscape, then portrait keeps taps correct. With getContext('webgl') returning null, the screen stays lit (0.98) and taps still work. Injecting --safe-area-inset-top after load re-lays out through the MutationObserver. No game rules were added to render, and the display canvas is still 2D-only.

Required changes:
1. Upscale rule (amends decision 2026-11-20 (c)). The 5% justification holds only at dpr >= 2, which is what the code's own comment says, but the code applies it at every dpr. Measured old vs new: 1600x900@1 goes from integer 3x to fractional 3.333x, 2560x1440@1 from 5x to 5.333x, and 1100x620@1 from 2x to 2.29x. These are uneven nearest-neighbour pixels on common 16:9 desktops, so the claim "16:9 is pixel-identical" is false at the device-pixel level. The S22+ and Pixel 7 are exact 4x under both rules, so the request does not need the change. Fix: keep the 20% threshold when dpr < 2 and allow 5% only when dpr >= 2, or restore 20% everywhere. Add unit tests pinning 1600x900@1 and 2560x1440@1 to an integer scale, and S22+ / Pixel 7 to 4x.
2. Stale hitTest after resize. onResize updates the renderer's cssW/cssH but leaves lastLayout on the old logical size until the next rAF, so a tap in that window hit-tests with mismatched scale. This breaks "hitTest accounts for scale". Fix: call refresh() (or rebuild lastLayout) in onResize after renderer.resize.
3. Target-device safety for the HUD. ROOM/SCORE and the mute/settings buttons now sit at the physical top edge and corners of the S22+, where the punch-hole camera and rounded corners are. Before this change they were inside letterbox bands. The safe-area inset path has not been checked on a device, and CSS insets never cover rounded corners. Fix: keep a minimum logical margin on the long axis for top-bar chrome and corner buttons whatever the insets say (the spare height E gives about 105 px of room), or attach screenshots from a real S22+ (or an emulator with the S22+ cutout and corner profile) in both orientations showing the HUD clear and the corner buttons fully visible and tappable.

Clearing conditions: changes 1 to 3 are done, with tests for 1 and 2 (for 2, a resize followed by an immediate hitTest returns the rect from the new layout). Typecheck, npm test and e2e are green. Re-review by Adama or Tigh, not Starbuck.

Advisories (not required): tests/e2e/util.ts toCss could read the logical size instead of assuming 480x270. The empty bottom band in portrait outside the tutorial could be put to use, for example by spreading the bands further. Remove the `void lh;` in drawTitle. The fullscreen e2e taps rect centres, so it would not detect a warp mismatch; consider adding an edge point.

### 2026-11-21: Fullscreen-layout revision: upscale threshold is 20% at dpr < 2 and 5% at dpr >= 2; long axis capped at the viewport aspect; HUD keeps a minimum edge margin (CHROME_EDGE 24, CHROME_EDGE_BOTTOM 8) regardless of safe-area insets; onResize refreshes the layout
**By:** Tyrol
**Recorded:** 2026-11-21T16-55-51
**References:** Adama, Starbuck, Tigh, fullscreen-layout, decision 2026-11-20 (c)
**Status:** APPROVED by Adama's review gate (2026-11-21T17-01-16). Amends ruling (c) of 2026-11-20T17-21-25 and items 1, 3 and 4 of Starbuck's fullscreen contract (2026-11-21T16-33-44).
**Why:** Amends decision 2026-11-20 (c) and the fullscreen-layout screen contract (src/render/screen.ts).

1. Integer-upscale threshold: INTEGER_WASTE = 0.2 (the recorded rule) applies when dpr < 2. INTEGER_WASTE_HIDPI = 0.05 applies only when dpr >= 2, where uneven nearest-neighbour pixels do not show. Pinned by unit tests: 1600x900@1 gives 3x, 2560x1440@1 gives 5x, 1100x620@1 gives 2x (all 480x270). The S22+ (412x892@2.625, both orientations) and the Pixel 7 (412x915@2.625) give exactly 4x.
2. The logical long axis is now min(MAX_LONG, round(270 * longDev / shortDev), floor(longDev / scale)), clamped to at least 480. When the integer snap letterboxes the short axis, a 16:9 window stays 480x270 with even bars and does not grow to 533x270. 16:9 frames are therefore identical to the pre-fullscreen constants at every dpr.
3. HUD edge margin: the safe box is max(inset, minimum) on each long-axis side, even when the insets report 0. The minimum is measured from the physical edge, so a long-axis letterbox counts towards it. Portrait uses top 24 and bottom 8. Landscape uses 24 on both sides, because the camera can be on either short edge. The margin comes out of the spare length beyond 16:9, so 16:9 (no spare) has margin 0 and its rects are unchanged. Justification for the S22+ (about 393 ppi, about 15.5 device px per mm, 4 device px per logical px): the punch-hole ends about 4.5 mm (about 18 logical px) below the edge, so the ROOM text at 24+5 sits about 11 logical px under it. The corner radius is about 6 mm (about 24 logical px), and the settings button's outer corner (4 px in, 27 px down) lies outside that arc. Bottom 8 keeps the 6 px-inset coach strip corners on the glass (the 24 px arc is 6 px in at 8.1 px up). The cost is 32 of the 105 spare logical px in S22+ portrait and 48 of the 105 in landscape. The numbers are estimates from published dimensions and have not been measured on a device.
4. app.ts onResize calls refresh() right after renderer.resize, so lastLayout always matches the renderer's CSS size. An e2e test taps from inside the resize event, before any rAF, and fails without the fix.

### 2026-11-21: Review gate: APPROVE fullscreen-layout (Tyrol revision). The upscale rule depends on dpr, hitTest refreshes on resize, and the HUD keeps minimum edge margins on the S22+. All three clearing conditions are met.
**By:** Adama
**Recorded:** 2026-11-21T17-01-16
**References:** Tyrol, Starbuck, Tigh, fullscreen-layout, decision 2026-11-20 (c), adama-review-gate-fullscreen-layout-starbuck-reject
**Status:** Supersedes the REJECT of 2026-11-21T16-47-12 on the same subject (fullscreen-layout).
**Why:** Re-review of the fullscreen-layout revision by Tyrol, against my REJECT of Starbuck's version.

Verified myself:
- typecheck and build clean. npm test 390/390. npm run test:e2e 49 passed, 5 skipped, exit 0.
- R1 (upscale rule). screen.ts uses INTEGER_WASTE 0.2 at dpr < 2 and 0.05 at dpr >= 2. An independent JS port of screenGeometry gives: 1600x900@1 -> 480x270 at 3x; 2560x1440@1 -> 5x; 1100x620@1 -> 2x; 1366x768@1 -> 2.844x (fractional, as under the recorded rule); 1920x1080@1 -> 4x. S22+ 412x892@2.625 -> 270x585 at 4x and 585x270 at 4x (fill 99.8%, about 1.5 device px of bars). Pixel 7 412x915 -> 270x600 at 4x. The S22+ with Chrome's URL bar (412x780, 412x846, 846x412, 780x412) stays at 4x and fills more than 99.6%. Unit tests pin 1600x900, 2560x1440 and 1100x620 to integer scales, and the S22+ and Pixel 7 to 4x.
- Aspect cap. It never adds bars on the S22+: aspectLong equals floor(longDev/4) to within one logical px in every S22+ case I probed. The 892x340@2.625 bars (about 160 device px on the long axis, fill 93%) come from the existing MAX_LONG 660 cap (the viewport is 2.6:1, past 22:9), not from the new aspect cap (aspectLong 708). This matches my earlier probe of Starbuck's version. The cap's only effect is to keep dpr-1 16:9 windows at 480x270 with even bars, which is the behaviour I asked for.
- R2 (stale hitTest). onResize calls refresh() after renderer.resize. Discrimination check: I removed that one line, ran 'resize then tap before the next frame', and it failed (data-screen never became game). I then restored app.ts byte for byte (md5 matched) and it passes in the full run. The test asserts the tap point misses PLAY and TUTORIAL under the old logical size, and that 0 rAF frames ran between the resize and the tap.
- R3 (HUD margins). The safe box is max(inset, CHROME_EDGE 24) on the top in portrait and on both sides in landscape, and max(inset, 8) on the bottom in portrait, with letterbox counted towards the minimum. 16:9 gives a safe box equal to the full canvas, so the frames are unchanged. Unit tests check that mute, settings, ROOM and SCORE are at least 24 from the physical edges on the S22+ in both orientations. The S22+ screenshots (portrait fight, landscape game) show the HUD well clear of the top edge and corners. The numbers are estimated from published specs, not measured on a device. That is acceptable because R3 asked for a minimum margin 'whatever the insets say', and that is what this provides.
- The relaxed '>40' threshold is legitimate. In landscape at 585 wide, the 2 x 24 side margins leave E = 57 (not 105). That gives gg = 4 and m = 7, so the deck-to-discard span grows by 43 (from 376 to 419). The test cannot be '>60' with these margins. The margins are what moved, not the spreading logic, and the columns still move outwards. The margin above the threshold is small (3), so any future change to the margins will need the test updated deliberately.
- Recorded decisions: no game rules were added to render (layout and screen are pure geometry), the display canvas is still 2D only, the WebGL-null fallback is unchanged by this revision, and hitTest goes through the same frame and logical size, so the CRT-warp taps in fullscreen.spec pass in both orientations.

Advisories (not required): the remaining `void lh;` is in drawGame (it predates this work), and my earlier note mislocated it, so it can be cleaned up separately. The empty bottom band in portrait outside the tutorial can still be put to use. A screenshot from a real S22+ should be taken when hardware is available, to confirm the CHROME_EDGE estimates.

Decision 2026-11-20 (c) is amended as Tyrol recorded: 20% at dpr < 2, 5% at dpr >= 2.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
