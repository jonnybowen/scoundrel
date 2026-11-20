# Project Context

- **Owner:** Jonny Bowen
- **Project:** Scoundrel - a lightweight, web-based single-player dungeon card game (rules by Zach Gage & Kurt Bieg), styled after Balatro with crunchy pixel graphics, juicy animation, and sound.
- **Stack (assumed default):** TypeScript + Vite, HTML Canvas/WebGL with a CRT post-process shader, Web Audio API, Vitest + Playwright. Static site, no backend.
- **Created:** 2026-11-20

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### 2026-11-20: Renderer, CRT, card art, UI shell (Design Review 1 contracts)
- Files: src/render/{theme,font,cardArt,layout,crt,renderer,types}.ts, src/ui/{view,settings,input,fallbacks,app}.ts, src/main.ts. Bundle is about 78 kB JS (28 kB gzip) with no dependencies.
- All art is procedural: a 3x5 bitmap font (text runs cached as canvases), 12x12 palette-string sprites scaled 2x (slime/bat/skull for 2-10, goblin J, wraith Q, demon K, dragon A, sword, potion), and 5x5 pips/icons. Card faces are cached per CardId. Suits have four distinct hues (hearts red, diamonds orange, clubs blue, spades indigo); kind is shown by the centre-panel colour and the value badge icon.
- Logical 480x270 landscape and 270x480 portrait. Card 56x78. The layout frames are tables in render/layout.ts, and hitTest identifies room cards by rect.y == roomY.
- The CRT barrel warp has a CPU mirror (warpUv) and hitTest must use it. Corners map out of range and draw black; edge midpoints are preserved by dividing by (1+k).
- Gotchas: createSession doesn't broadcast its opening events (subscribe, then newGame). Space must not restart from the result screen. FX ghost cards are drawn by parsing the CardId. Room cards held at opacity 0 are added back to the deck count.
- Verification: a Playwright script in the scratchpad, run against vite preview, covered desktop 1280x720 and Pixel 7 portrait with reduced motion: title, deal, hover tooltip, weapon/fists choice, slain fan, touch tap, result screen, settings menu, CRT off. No page errors.

### 2026-11-20: Resume-on-reload, phase 1 (standalone module)
- Files: src/ui/save.ts and tests/unit/save.test.ts (27 tests). It is not wired into app.ts yet; the integration waits for Tyrol's tutorial-ui fix.
- Gotcha: tutorialController.start() calls session.newGame(tutorialGameOptions()) BEFORE setting itself active, so an `isScripted: () => tutorial.active` predicate reads false during the tutorial deal. The save module therefore verifies on its own that (seed, rules, log) reproduces the live state before every write. A scripted deck never reproduces from its seed, so it is never saved.
- session.replay emits one combined batch, so attachAutosave re-saves the same record after a restore. That is harmless, and fx.skip() must follow.
- Greedy first-legal-action play loses quickly (often under 12 steps), so tests that need a mid-run state should play 2 to 4 steps and assert the phase.
