# Architecture

Scoundrel is a static, client-only web game: TypeScript, Vite, Canvas/WebGL, Web Audio. No backend.
This document records module boundaries and contracts agreed at the first Design Review (Adama, 2026-11-20).
Rules live in [RULES.md](RULES.md).

## Principles

1. **The rules engine is pure.** `src/game` has no DOM, no timers, no `Math.random`, no I/O. Same inputs, same outputs.
2. **Events, not diffs.** Every state transition returns an ordered `GameEvent[]`. Presentation animates and
   sonifies events. It never diffs `GameState` to work out what happened.
3. **Render is a function.** The screen is drawn from `GameView + LayoutSnapshot + FxFrame`. Render holds no
   game logic and never mutates game state.
4. **Determinism.** A game is fully reproduced by `seed + rules + action log`. This powers tests, replays,
   save/load and daily-seed mode.
5. **Boring tools.** Vite, Vitest, Playwright, plain TypeScript. No framework or game engine.

## Modules

```
src/
  game/      Rules engine and session (owner: Tyrol). Pure, DOM-free.
  ui/        View model, layout types, input intents, settings, app composition root (owner: Starbuck).
  render/    Canvas/WebGL drawing, CRT post-process, hit testing (owner: Starbuck).
  fx/        Animation director: tweens, shake, flashes, popups, cues (owner: Gaeta).
  audio/     Web Audio engine: SFX, music, buses, mute (owner: Gaeta).
  main.ts    Entry point. Creates the app.
tests/
  unit/      Vitest, Node environment. Rules and pure logic (owner: Tigh).
  e2e/       Playwright, desktop + mobile Chromium (owner: Tigh).
docs/        RULES.md, ARCHITECTURE.md.
```

### Allowed dependencies

```
game   <- ui, render, fx, audio   (via src/game/index.ts only; type imports preferred outside ui)
ui/view.ts <- render, fx           (shared presentation types)
fx/types.ts <- render              (FxFrame)
game   -> nothing
```

`src/game` must never import from another `src/` folder. Enforced by `tsconfig.game.json`, which typechecks
`src/game` without the DOM lib (part of `npm run typecheck`), and by code review.

## Data flow

```
 pointer/keys --> Renderer.hitTest --> UiIntent --> ui/app --> session.dispatch(GameAction)
                                                                  |
                                                     engine.step (pure)
                                                                  |
                                       listeners(events, state) <-+
                                                  |
                                     fx.enqueue(events)
                                                  |
                    each frame: fx.update(dt, layout) --> FxFrame --> Renderer.draw(view, layout, fx, t)
                                                  |
                                     fx.onCue(event) --> audio.handleEvent(event)
```

- **Engine state jumps immediately; presentation catches up.** FX plays event batches in order over time.
  Cards that have not "arrived" yet are positioned by FX transforms, so the screen never shows the future.
- **Input gating.** While `fx.isBusy()`, the UI ignores game actions (hover still works). A tap during
  animation calls `fx.skip()` to fast-forward.
- **Audio follows animation.** SFX fire on FX cues when an event lands on screen, not when it was dispatched.
  With reduced motion on, FX completes instantly but still emits every cue.

## Contracts (files)

| Contract | File | Producer | Consumers |
|----------|------|----------|-----------|
| Card, Suit, Rank, deck constants | `src/game/cards.ts` | Tyrol | all |
| Seeded RNG (`Rng`, `createRng`, `shuffle`) | `src/game/rng.ts` | Tyrol | engine, tests |
| `GameState`, `RulesOptions`, `Phase` | `src/game/state.ts` | Tyrol | ui (read-only) |
| `GameAction`, `RuleViolation` | `src/game/actions.ts` | Tyrol | ui |
| `GameEvent` union | `src/game/events.ts` | Tyrol | fx, audio, ui, tests |
| `createGame`, `step`, queries, `computeScore` | `src/game/engine.ts` | Tyrol | session, ui, tests |
| `GameSession` (state holder + event bus) | `src/game/session.ts` | Tyrol | ui/app |
| `GameView`, `LayoutSnapshot`, `HitTarget`, `UiIntent` | `src/ui/view.ts` | Starbuck | render, fx |
| `Renderer`, `computeLayout`, `CrtParams` | `src/render/types.ts` | Starbuck | ui/app |
| `FxDirector`, `FxFrame`, `FxCue` | `src/fx/types.ts` | Gaeta | render, ui/app, audio |
| `AudioEngine`, `SfxId`, `MusicId` | `src/audio/types.ts` | Gaeta | ui/app |
| `Settings` | `src/ui/settings.ts` | Starbuck | audio, render, fx |

Stubs throw `not implemented: <fn> (owner: <name>)` until their owner replaces them.
Changing a contract shape needs a Design Review and a recorded decision.

## Engine API summary

- `createGame({ seed, rules?, rngFactory? })` returns `{ state, events }`.
- `step(state, action)` returns `{ ok: true, state, events }` or `{ ok: false, state, violation }`. It never throws on illegal input.
- Actions: `enterRoom`, `avoidRoom`, `playCard { cardId, mode?: 'weapon' | 'barehanded' }`.
- Queries for the UI: `legalActions`, `canAvoidRoom`, `canUseWeaponOn`, `weaponLimit`, `previewDamage`, `computeScore`.
- `GameState` is plain JSON (saved games are `JSON.stringify(state)` or `seed + history`).
- Room is 4 positional slots (`Card | null`) so cards keep their place on screen. Sprites key off `Card.id`.

## Rendering

- Scene drawn at a fixed logical resolution (`480x270`, landscape; portrait layout for phones) into an offscreen target,
  then upscaled nearest-neighbour by a WebGL CRT pass (scanlines, curvature, vignette, chromatic aberration, noise).
- 2D-canvas fallback without CRT when WebGL is unavailable.
- `hitTest` maps CSS pixels to targets and must account for scale and CRT warp.
- Pixel-art assets ship as files in `public/` or imported assets; `assetsInlineLimit: 0` keeps them out of the JS bundle.

## Audio

- One lazily created `AudioContext`, unlocked on the first user gesture.
- Bus graph: `sfx` and `music` into `master`. Mute is independent of volume. Settings persist in `localStorage`.
- Missing audio support degrades to silence, never an exception.

## Testing

- `npm test`: Vitest in Node. Rules tests use fixed seeds and injected RNGs; no DOM needed.
- `npm run test:e2e`: Playwright against `vite preview` (desktop and Pixel 7 Chromium). Use `?seed=` for deterministic runs.
  First run needs `npx playwright install chromium`.
- `npm run typecheck`: app, DOM-free engine gate, and Node config files.

## Out of scope for now

Deploy pipeline, PWA/offline, leaderboards, accounts, analytics.
