# Interactive tutorial

Design Review 2 (Adama, 2026-11-20). This file is the design and lesson script for the tutorial. It is the
source of truth for the words, the scripted dungeon and the gates. Contracts live in code (see "Contracts").

The user directive reads: "please ensure there is an interactive tutorial to teach the game". The tutorial is
learn-by-doing. The player plays a real, scripted game on the real board, and a coach panel tells them what to do
next. It is not a rules page. It is a ship requirement. Reviewers REJECT any build where the tutorial is missing
or fails to teach one of these:

| Concept | Where the player does it |
|---------|--------------------------|
| Monsters, weapons, potions | Room 1: intro, equip the 5, fight the 8 with it, drink the 5 |
| Rooms: play 3, leave 1 | Room 1 clears with the 3 of clubs carried, and again in rooms 3, 4 and 5 |
| Avoiding, never twice in a row | Room 2 is avoided. Room 3: the player presses AVOID and the engine refuses |
| Weapon degradation (by the last kill) | Room 3: after killing the 6, the 9 is too big for the weapon. The 4 still fits |
| One potion heals per room | Room 4: the 4 heals, then the 2 is wasted |
| Winning, losing, scoring | Room 5: losing explained, and a lethal barehanded Ace is refused. Room 6: win, with the potion bonus (score 30) |

## Principles

1. **The engine is the rules authority. There are no tutorial rule forks.** The tutorial does three things:
   it picks the deck order (`createGame({ deck })`), it narrows which legal moves the player may make right now
   (the gate), and it listens to engine events and violations to decide when a step is done. Every HP change,
   refusal and score the player sees comes from `src/game`.
2. **Pure step machine.** `src/tutorial` is DOM-free and deterministic, and it imports only `src/game`. It sits
   inside the `tsconfig.game.json` purity gate. Given the same inputs, it produces the same coach view.
3. **The real board.** The tutorial uses the normal game screen, renderer, FX and audio. The coach is an overlay.
   No tutorial-only card art or fake animations.
4. **Gentle.** A wrong move is blocked before it reaches the engine. The coach panel shows a nudge and plays a soft
   blip. There is no HP cost, no toast and no "denied" buzzer. The only time the engine itself refuses a move is the
   avoid-twice lesson, which is the point of that step.

## Entering, leaving, remembering

- **Title button.** The title screen always shows a `TUTORIAL` button (`ButtonId 'tutorial'`) under `PLAY`.
  Key: `T`.
- **First-launch offer.** While `settings.tutorialSeen` is false, the title shows a modal panel
  (`chrome.tutorialOffer`): "FIRST TIME IN THE DUNGEON?" with `TEACH ME` (`tutorialAccept`, key `Enter`) and
  `I KNOW THE RULES` (`tutorialDecline`, key `Esc`). PLAY is hidden while the offer is up. Mute and settings
  stay available.
- **`tutorialSeen`** becomes true, and is persisted by the app (the single Settings writer), when the player
  accepts, declines, starts the tutorial from the title button, leaves it, or reaches the recap. Older saves
  without the field load as false, so existing players see the offer once.
- **Leaving.** The coach panel has a small `SKIP` button (`tutorialSkip`, key `X`). While the tutorial runs, the
  settings menu replaces `RESTART RUN` with `LEAVE TUTORIAL` (the same intent). Leaving goes straight to the title
  with no confirmation, because restarting is one tap away. During the tutorial, `N` (new game) does nothing.
  A real run starts only from the recap or from the title.
- **Recap.** After the final win finishes presenting, the recap replaces the normal result panel. It offers
  `PLAY A REAL RUN` (`tutorialPlayReal`, key `Enter`, which starts a normal random-seed game),
  `REPLAY TUTORIAL` (`tutorialReplay`, key `R`) and `Esc` for the title.

## Scripted dungeon

`createGame({ seed: TUTORIAL_SEED, deck, rules: DEFAULT_RULES })` uses this exact order. The top of the deck is
dealt first. Constant: `TUTORIAL_DECK_ORDER` in `src/tutorial/types.ts`.

```
D5 S8 C3 H5 | S14 C7 H10 | S6 C9 C4 H4 | D10 H2 C2      (14 cards)
```

Simulated with the real rules (slot order left to right; keys 1-4 select slots):

| Room | Slots 1-4 at reveal | Player does | HP after | Carried | Notes |
|------|--------------------|-------------|----------|---------|-------|
| 1 | D5 S8 C3 H5 | equip D5; S8 with weapon (-3); drink H5 (+3, capped) | 20 | C3 (slot 3) | weapon D5, limit 8 |
| 2 | S14 C7 C3 H10 | AVOID | 20 | none | S14 C7 C3 H10 go to the bottom, in slot order |
| 3 | S6 C9 C4 H4 | AVOID is refused (cannotAvoidTwice); S6 with weapon (-1); C9 barehanded (-9); C4 with weapon (0) | 10 | H4 (slot 4) | limit 8, then 6, then 4 |
| 4 | D10 H2 C2 H4 | drink H4 (+4); drink H2 (wasted); equip D10 (D5 and its 3 kills discarded) | 14 | C2 (slot 3) | fresh weapon, no limit |
| 5 | S14 C7 C2 C3 | S14 with weapon (-4); C7 with weapon (0); C3 with weapon (0) | 10 | C2 (slot 3) | 1 card left in deck. Limit 14, then 7, then 3 |
| 6 (final) | H10 - C2 - | C2 with weapon (0); drink H10 (+10) | 20 | n/a | deck empty (A4): cannot avoid, resolve all |

Result: **GameWon, score 30** (20 HP plus a 10 bonus for the potion as last card at full HP). The script works the
same under `weaponLimit: 'lt'` (every weapon fight is strictly below the limit), but the tutorial always uses
`DEFAULT_RULES`.

## Lesson script

Conventions:
- **Type**: `next` steps finish when the player presses NEXT on the last page. `action` steps finish when the
  trigger fires.
- **Gate**: `expect` is the only move the player may make. Any page of the step accepts it, and acting early skips
  the remaining pages. In `choosing`, `enterRoom` is also allowed (it does not advance) when the expected move
  is a `playCard`. A matcher with no `mode` matches any mode and the card-tap `select` query.
- **Coach text** is upper case and uses only glyphs the 3x5 font has: `A-Z 0-9 space - + . , : ! ? ' / < > = % ( ) #`.
  No suit symbols, quotes or semicolons. Each page is at most 138 characters, which wraps to 3 lines of 46.
- **Spot** is the spotlight list. `→` marks the arrow target (`spotlight[0]` with `arrow: true`).
- **Nudge**: the default text for any other move. Specific nudges are listed as `move: text`.

### Lesson 1/7: THE CARDS (room 1, choosing)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 1 | `welcome` | next | →region deck, region hp | 1. "WELCOME, SCOUNDREL. THIS DECK IS THE DUNGEON. GET THROUGH EVERY CARD ALIVE AND YOU WIN." 2. "YOU START WITH 20 HP. HERE IS YOUR HEALTH." | NEXT | "PRESS NEXT (ENTER) TO CONTINUE." |
| 2 | `monsters` | next | →card S8, card C3 | "CLUBS AND SPADES ARE MONSTERS. A MONSTER HITS YOU FOR ITS VALUE. J=11 Q=12 K=13 A=14." | NEXT | same |
| 3 | `weapons` | next | →card D5 | "DIAMONDS ARE WEAPONS. A WEAPON BLOCKS AS MUCH DAMAGE AS ITS VALUE." | NEXT | same |
| 4 | `potions` | next | →card H5, region hp | "HEARTS ARE POTIONS. THEY HEAL BY THEIR VALUE, BUT NEVER ABOVE 20 HP." | NEXT | same |

### Lesson 2/7: ROOMS (room 1)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 5 | `roomRule` | next | →region room | 1. "THESE 4 CARDS ARE A ROOM. FACE IT BY PLAYING 3 OF THEM, ONE AT A TIME, IN ANY ORDER." 2. "THE 4TH CARD STAYS BEHIND AND JOINS THE NEXT ROOM." | NEXT | "PRESS NEXT (ENTER) TO CONTINUE." |
| 6 | `r1Equip` | action | →card D5 | "START WITH THE WEAPON. TAP THE 5 OF DIAMONDS, OR PRESS 1." | expect `playCard D5`; until `WeaponEquipped` D5 | "FIRST, PICK UP THE 5 OF DIAMONDS (KEY 1)." `avoidRoom`: "NO RUNNING YET. WE WILL TRY AVOIDING SOON." |
| 7 | `r1Fight` | action | →card S8, control fightWeapon | "NOW FIGHT THE 8 OF SPADES. TAP IT (KEY 2), THEN PICK THE SWORD (KEY W)." | expect `playCard S8 weapon`; until `MonsterSlain` S8 | "TAP THE 8 OF SPADES (KEY 2), THEN THE SWORD (W)." `playCard S8 barehanded`: "BAREHANDED TAKES THE FULL 8. PICK THE SWORD (W)." |
| 8 | `r1FightDone` | next | →region slainStack, region weapon, region hp | "THE WEAPON BLOCKED 5, SO 8 - 5 = 3 DAMAGE. THE 8 NOW SITS ON YOUR WEAPON. REMEMBER THAT." | NEXT | default |
| 9 | `r1Potion` | action | →card H5, region hp | "YOU ARE AT 17 HP. DRINK THE 5 OF HEARTS (KEY 4)." | expect `playCard H5`; until `PotionUsed` H5 | "DRINK THE 5 OF HEARTS (KEY 4)." `playCard C3`: "LEAVE THE 3. IT STAYS FOR THE NEXT ROOM." |
| 10 | `r1Cleared` | next | →card C3 | 1. "HEALED 3. HP NEVER GOES ABOVE 20." 2. "3 CARDS PLAYED, SO THE ROOM IS DONE. THE 3 OF CLUBS STAYED AND 3 NEW CARDS JOINED IT." | NEXT | default |

### Lesson 3/7: AVOIDING (rooms 2-3)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 11 | `r2Look` | next | →card S14, card H10 | 1. "TROUBLE. THE ACE OF SPADES HITS FOR 14, AND AT FULL HP THAT POTION WOULD HEAL NOTHING." 2. "YOUR WEAPON CANNOT TOUCH THE ACE EITHER. MORE ON THAT SOON." | NEXT | default |
| 12 | `r2Avoid` | action | →control avoid | "YOU CAN AVOID A ROOM: ALL 4 CARDS GO TO THE BOTTOM OF THE DECK. PRESS AVOID (KEY A)." | expect `avoidRoom`; until `RoomAvoided` | "NOT THIS ROOM. PRESS AVOID (KEY A)." |
| 13 | `r3TryAvoid` | action | →control avoid | "A FRESH ROOM. TRY TO AVOID THIS ONE TOO (KEY A)." | expect `avoidRoom`; until **violation** `cannotAvoidTwice` | "HUMOUR ME: PRESS AVOID FIRST (KEY A)." |
| 14 | `r3Refused` | next | →control avoid | "REFUSED! AVOID AS OFTEN AS YOU LIKE, BUT NEVER TWO ROOMS IN A ROW. THIS ONE MUST BE FACED." | NEXT | default |

In step 13 the AVOID button is drawn grey (`canAvoid` false) but stays clickable. The gate allows the action,
the engine rejects it, and the app shows its usual toast ("CAN'T AVOID TWO ROOMS IN A ROW") with `uiDenied`. This
is the only engine refusal in the script, and it is the lesson.

### Lesson 4/7: WEAPONS DULL (room 3)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 15 | `r3Fight6` | action | →card S6, control fightWeapon | "FIGHT THE 6 OF SPADES WITH YOUR WEAPON (KEY 1, THEN W)." | expect `playCard S6 weapon`; until `MonsterSlain` S6 | "THE 6 OF SPADES, WITH THE SWORD (KEY 1, THEN W)." `S6 barehanded`: "USE THE SWORD (W). IT BLOCKS 5 OF THE 6." |
| 16 | `r3Dull` | next | →region weaponLimit, region slainStack | 1. "WEAPONS DULL. ONCE USED, A WEAPON ONLY FIGHTS MONSTERS NO STRONGER THAN THE LAST ONE IT KILLED." 2. "IT JUST KILLED A 6, SO ITS LIMIT IS NOW 6." | NEXT | default |
| 17 | `r3TooDull` | action | →card C9, region weaponLimit | "THE 9 OF CLUBS IS OVER YOUR LIMIT OF 6, SO THE WEAPON CANNOT FIGHT IT. TAKE IT BAREHANDED (KEY 2)." | expect `playCard C9 barehanded`; until `MonsterSlain` C9 | "FACE THE 9 OF CLUBS BAREHANDED (KEY 2)." `H4`: "SAVE THE POTION. IT WILL STAY FOR THE NEXT ROOM." |
| 18 | `r3Fight4` | action | →card C4, control fightWeapon | "THE 4 OF CLUBS IS UNDER 6, SO THE WEAPON STILL WORKS. USE THE SWORD (KEY 3, THEN W)." | expect `playCard C4 weapon`; until `MonsterSlain` C4 | "THE 4 OF CLUBS, WITH THE SWORD (KEY 3, THEN W)." `C4 barehanded`: "NO NEED TO BLEED. THE SWORD (W) BLOCKS ALL 4." `H4`: "SAVE THE POTION. IT WILL STAY FOR THE NEXT ROOM." |

For the 9, the UI never offers the sword because `canUseWeapon` is false, so tapping it fights barehanded at once.
The lesson is the spotlit limit badge together with the full 9 damage.

### Lesson 5/7: POTIONS (room 4)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 19 | `r4Drink` | action | →card H4, card H2, region hp | 1. "YOU ARE AT 10 HP, AND THIS ROOM HAS 2 POTIONS. ONLY ONE POTION PER ROOM HEALS." 2. "DRINK THE BIGGER ONE: THE 4 OF HEARTS (KEY 4)." | expect `playCard H4`; until `PotionUsed` H4 | "DRINK THE 4 OF HEARTS (KEY 4)." `H2`: "THE 4 OF HEARTS FIRST (KEY 4). BIGGER IS BETTER." |
| 20 | `r4Waste` | action | →card H2 | "NOW DRINK THE 2 OF HEARTS TOO (KEY 2), AND WATCH WHAT HAPPENS." | expect `playCard H2`; until `PotionWasted` H2 | "DRINK THE 2 OF HEARTS (KEY 2)." |
| 21 | `r4Wasted` | next | →region hp, region discard | "WASTED! A 2ND POTION IN THE SAME ROOM DOES NOTHING. IN A REAL RUN, LEAVE SPARE POTIONS FOR LATER ROOMS." | NEXT | default |
| 22 | `r4NewWeapon` | action | →card D10, region weapon | "TAKE THE 10 OF DIAMONDS (KEY 1). A NEW WEAPON REPLACES THE OLD ONE AND ITS KILLS, AND STARTS SHARP." | expect `playCard D10`; until `WeaponEquipped` D10 | "TAKE THE 10 OF DIAMONDS (KEY 1)." `C2`: "LEAVE THE 2 OF CLUBS FOR LATER." |

### Lesson 6/7: WINNING AND LOSING (room 5)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 23 | `r5Return` | next | →card S14, card C7, card C3 | "LOOK FAMILIAR? AVOIDED CARDS COME BACK. THE ACE IS HERE, BUT NOW YOU HOLD A FRESH 10." | NEXT | default |
| 24 | `r5Losing` | next | →region hp, region score | 1. "IF YOUR HP HITS 0, THE RUN IS OVER AND YOU LOSE." 2. "THEN YOUR SCORE IS NEGATIVE: MINUS THE VALUE OF EVERY MONSTER STILL IN THE DUNGEON." | NEXT | default |
| 25 | `r5Ace` | action | →card S14, control fightWeapon, region hp | "BAREHANDED, THE ACE HITS FOR 14 AND YOU HAVE 14 HP. THAT IS DEATH. USE THE SWORD (KEY 1, THEN W)." | expect `playCard S14 weapon`; until `MonsterSlain` S14 | "BIG MONSTERS FIRST, WHILE THE BLADE IS SHARP. THE ACE (KEY 1)." `S14 barehanded`: "THAT WOULD KILL YOU! PICK THE SWORD (W)." |
| 26 | `r5Seven` | action | →card C7, region weaponLimit | "ONLY 4 DAMAGE. YOUR LIMIT IS NOW 14. BIG ONES FIRST: THE 7 OF CLUBS, WITH THE SWORD (KEY 2, THEN W)." | expect `playCard C7 weapon`; until `MonsterSlain` C7 | "BIG ONES FIRST: THE 7 (KEY 2, THEN W). EACH KILL LOWERS THE LIMIT." |
| 27 | `r5Three` | action | →card C3 | "THEN THE 3 OF CLUBS (KEY 4, THEN W). LEAVE THE 2 FOR THE LAST ROOM." | expect `playCard C3 weapon`; until `MonsterSlain` C3 | "THE 3 OF CLUBS, WITH THE SWORD (KEY 4, THEN W)." `C2`: "KEEP THE 2 FOR LAST. TAKE THE 3 (KEY 4)." |

Losing is taught without making the player lose. Step 24 explains it on the HP meter and the live score, and
step 25 is a real near-miss: the barehanded option on the Ace would end the run, so the gate refuses it with a nudge.
The player can always see the true cost in the fight buttons (`-14` fists, `-4` sword).

### Lesson 7/7: THE FINAL ROOM (room 6)

| # | id | Type | Spot | Pages | Gate / trigger | Nudge |
|---|----|------|------|-------|----------------|-------|
| 28 | `r6Final` | next | →region deck, region room | "THE DECK IS EMPTY, SO THIS IS THE FINAL ROOM. YOU CANNOT AVOID IT, AND EVERY CARD MUST BE PLAYED." | NEXT | default |
| 29 | `r6Two` | action | →card C2, region weaponLimit | "THE 2 OF CLUBS FITS UNDER YOUR LIMIT OF 3. SWORD (KEY 3, THEN W)." | expect `playCard C2 weapon`; until `MonsterSlain` C2 | "THE 2 OF CLUBS, WITH THE SWORD (KEY 3, THEN W)." `H10`: "POTION LAST. TRUST ME." |
| 30 | `r6Potion` | action | →card H10, region hp | "FINISH WITH THE POTION (KEY 1)." | expect `playCard H10`; until `GameWon` | "DRINK THE 10 OF HEARTS (KEY 1)." |

### Recap

Shown once the `GameWon` batch has finished presenting. It replaces the normal result panel.

- Title: `DUNGEON CLEARED!`
- Score: `30`, with the breakdown `20 HP + 10 POTION BONUS`
- Lines (`RecapView.lines`):
  1. `MONSTERS HIT. WEAPONS BLOCK. POTIONS HEAL.`
  2. `PLAY 3 CARDS PER ROOM. THE 4TH STAYS.`
  3. `AVOID ANY ROOM, BUT NEVER 2 IN A ROW.`
  4. `A WEAPON ONLY FIGHTS UP TO ITS LAST KILL.`
  5. `ONE POTION HEALS PER ROOM.`
  6. `WIN: SCORE = HP. AT 20 HP, A LAST-CARD POTION ADDS ITS VALUE.`
  7. `LOSE: SCORE = MINUS THE MONSTERS LEFT.`
- Buttons: `PLAY A REAL RUN` (Enter), `REPLAY TUTORIAL` (R). Esc goes to the title.

## Gating

These rules are normative. They are implemented in `src/tutorial/machine.ts` `gate()`.

1. In phase `recap` or `desynced`, every game move is blocked.
2. On a `next` step, every game move is blocked with the step nudge.
3. On an `action` step, the expected move is allowed on any page. A card tap (`select`) is allowed when the expected
   move plays that card. That covers the tap that only opens the sword/fists choice, which the app gates before
   setting `pendingFight`. A monster's `mode` must match (absent counts as `barehanded`).
4. `enterRoom` is allowed while choosing if the step expects a `playCard`. It never advances.
5. Anything else is blocked with the first matching specific nudge, or else the step nudge. Blocked moves never
   reach the engine. No HP is lost and nothing is logged in `session.history`.
6. The gate only narrows legal play. It never allows something the engine would refuse, except step 13, where the
   refusal is the trigger.

Advance rules (`advance()`): a batch completes at most one step. `next` pages first and then completes `next`
steps. A `GameWon` batch moves the machine to `recap`. If, after any completion, the expected card is not in the
room, or a batch contains `GameLost`, the machine goes to `desynced`. That cannot happen with the gate in place,
but if it does, the coach says "SOMETHING WENT WRONG. PRESS NEXT TO RESTART THE TUTORIAL." so the player is never
stuck.

## FX timing (`fx.isBusy`)

The engine and the machine advance at once on dispatch. The screen catches up over time, and so must the coach.

- **Latch.** `TutorialController.chrome(fxBusy)` returns the chrome as it was when FX went busy, for as long as FX
  is busy. When FX goes idle, the new step's chrome swaps in. At that moment the controller emits signals:
  `stepSucceeded` if an action step was completed, then `coachShown`. So the coach never talks about a card that is
  still in flight, and the success chime lands after the animation.
- **Input.** `tutorialNext` is gated like game actions: while FX is busy, it calls `fx.skip()` and does nothing
  else. The same applies to tap-to-skip. Gate checks run against `session.state`, which is never stale.
- **Tutorial FX never block.** `fx.tutorialCue` only drives `FxFrame.coach`. It never queues, never extends
  `isBusy()`, and never delays game-event cues.
- **Recap** appears under the same rule as the result panel: phase `won` and `!fx.isBusy()`.

## Reduced motion

With `settings.reducedMotion` on, FX presents batches instantly, as today, so coach text swaps at once. The
spotlight is a static ring (`spotlightPulse` fixed at 0.5), with no arrow bob, panel bump, nudge shake or success
flash. The dim layer is unchanged. There is no typewriter text in either mode; pages appear whole. Audio cues still
play.

## Layout and mobile (Starbuck)

- **Landscape (480x270).** The coach panel is a strip at about `(8, 214, 464, 52)`, below the HP meter and weapon,
  and it replaces the hint line (render suppresses `hintText` while `chrome.tutorial` is set). The text column is
  left aligned, with `LESSON n/7` and the title in gold, NEXT bottom right, and SKIP top right. The sword/fists
  buttons (x 370) stay clear of the panel.
- **Portrait (270x480).** The panel sits at about `(6, 416, 258, 60)`, below the fight/avoid buttons (which end at
  y 414). NEXT is at least 20 logical px tall (80 CSS px at 4x). On info steps a tap anywhere on the panel counts as
  NEXT. The card tooltip must not cover the panel.
- **Spotlight.** A dim layer (about 55% black) with rounded holes over each spotlight rect, plus a 1 px gold ring
  pulsed by `FxFrame.coach.spotlightPulse`. Rects come from `layout.cards` (card), `layout.buttons` (control) and
  `layout.regions` (region: hp, score, deck, discard, room, weapon, weaponLimit, slainStack). Control targets that
  are not laid out yet (fightWeapon before a card is tapped) are skipped, not errors. The pending-fight buttons are
  never dimmed.
- **Arrow.** A pixel arrow from the panel edge to `spotlight[0]`, bobbing by `arrowBob`.
- **Hit testing** is unchanged. The dim layer is visual only, so taps on dimmed cards reach the gate and get a
  nudge. Tutorial buttons go in `layout.buttons`. Do not use the `newGame` id in the tutorial, because hitTest
  disables cards when `newGame` is laid out.
- **Accessibility and test hook.** The app mirrors the coach into a visually hidden
  `<div id="coach-live" aria-live="polite">` in index.html. It holds the title, page text and nudge, plus
  `data-step`, `data-page`, `data-phase` (`coaching`|`recap`|`desynced`) and `data-ready` (`true` when FX is idle
  and the chrome is not latched). The div is empty and `data-phase` is absent outside the tutorial. Screen-reader
  users get the coaching, and e2e tests get a stable signal without reading pixels.

## Keyboard map in the tutorial

| Key | Meaning |
|-----|---------|
| `T` | Title: start the tutorial |
| `Enter` | Offer: TEACH ME. Coach: NEXT when `showNext`, otherwise enterRoom as usual. Recap: PLAY A REAL RUN |
| `ArrowRight` | NEXT (no-op when not shown) |
| `Esc` | Offer: decline. Pending fight: cancel. Recap: title. Settings: close |
| `X` | Leave the tutorial |
| `R` | Recap: replay |
| `1-4`, `W`, `B`, `A`, `Space`, `M`, `S`, `C` | As in the game. `N` is ignored in the tutorial |

## Audio and FX cues (Gaeta)

| Signal (TutorialController) | Audio (`TutorialSfxId`) | FX (`fx.tutorialCue`) |
|-----------------------------|-------------------------|------------------------|
| `coachShown` (new page or step) | `coachBlip` | `coachShown`: panelBump, spotlight on |
| `stepSucceeded` | `stepSuccess` (short rising chime) | `stepSucceeded`: green border flash |
| `nudged` (blocked move) | `coachBlip` at pitch 0.8 (never `uiDenied`) | `nudged`: small panel shake |
| `completed` (recap visible) | `tutorialComplete` | `completed` |

`TutorialSfxId` is merged into `SfxId` when the synth voices land. `win` still plays on `GameWon` through the normal
FxCue path.

## Contracts

| Contract | File | Producer | Consumers |
|----------|------|----------|-----------|
| `NewGameOptions.deck` (play this deck, no shuffle) | `src/game/engine.ts` | Tyrol | tutorial |
| Step ids, deck order, script schema, `TutorialState`, `TutorialQuery`, `GateResult`, `TutorialInput`, `CoachView`, `RecapView`, `TutorialChrome`, `SpotlightTarget`, `RegionId` | `src/tutorial/types.ts` | Tyrol | ui, render, tests |
| `tutorialGameOptions`, `startTutorial`, `currentStep`, `gate`, `advance`, `tutorialChrome` | `src/tutorial/machine.ts` | Tyrol | ui controller, tests |
| `tutorialSteps`, `tutorialRecap` | `src/tutorial/script.ts` | Tyrol | machine, tests |
| Tutorial ButtonIds and UiIntents, `ViewChrome.tutorial` / `tutorialOffer`, `LayoutSnapshot.regions` / `coach` | `src/ui/view.ts` | Starbuck | render, input, app |
| `Settings.tutorialSeen` | `src/ui/settings.ts` | Starbuck | app |
| `TutorialController`, `TutorialSignal` | `src/ui/tutorialController.ts` | Starbuck | app |
| `drawSpotlight`, `drawCoach`, `drawRecap`, `drawOffer` | `src/render/coach.ts` | Starbuck | renderer |
| `FxFrame.coach` (`CoachFx`), `FxDirector.tutorialCue?`, `TutorialFxCue` | `src/fx/types.ts` | Gaeta | render, app |
| `CoachFxTrack` | `src/fx/coach.ts` | Gaeta | director |
| `TutorialSfxId` | `src/audio/types.ts` | Gaeta | app |

`createGame({ deck })` semantics: the deck is used as given, top first, with no shuffle and no RNG call. It must
be non-empty with unique card ids, or `createGame` throws a `RangeError`; that is a programming error, not player
input. Everything after that (first deal, events, `GameStarted.deckSize` = deck length, rules) is identical to a
shuffled game. `replay(opts, actions)` with the same options reproduces it.

All new view and FX fields are optional, and every stub throws `not implemented: X (owner: Y)`. Nothing is wired
into `app.ts` yet, so normal play is unchanged until the owners land their parts.

## Ownership and integration

| Owner | Files (distinct) | Work |
|-------|------------------|------|
| **Tyrol** | `src/tutorial/machine.ts`, `src/tutorial/script.ts` (and `types.ts` for contract changes), `src/game/engine.ts` (`deck` option only) | Step machine, script data matching this doc, deck option and validation |
| **Starbuck** | `src/ui/tutorialController.ts`, `src/ui/app.ts`, `src/ui/input.ts`, `src/ui/view.ts`, `src/ui/settings.ts`, `src/render/coach.ts`, `src/render/layout.ts`, `src/render/renderer.ts`, `index.html` | Controller, **app.ts integration (owner)**, key map, title button and offer, coach panel, spotlight, arrow, recap, regions and coach rects in both orientations, `#coach-live` |
| **Gaeta** | `src/fx/coach.ts`, `src/fx/director.ts`, `src/audio/synth.ts`, `src/audio/types.ts` | Coach FX track (pulse, bob, bump, shake, success), `tutorialCue`, the three tutorial SFX voices, merging `TutorialSfxId` into `SfxId` |
| **Tigh** | `tests/unit/tutorial.test.ts`, `tests/unit/deckOption.test.ts`, `tests/e2e/tutorial.spec.ts`, `tests/e2e/smoke.spec.ts` | Unit and e2e coverage below |

**The integration point is `src/ui/app.ts`, owned by Starbuck.** It touches 5 places, listed in the
`tutorialController.ts` header: the newGame path, the session listener, `dispatch()` gating, `refresh()` chrome, and
the `handle()` intents and settings. Gaeta does not edit app.ts. Starbuck maps `TutorialSignal` to `audio.play` and
`fx.tutorialCue` using the table above.

Order: Tyrol (machine, script, deck) and Gaeta (FX, audio) can start now in parallel. Starbuck builds the render
pieces against the contract, then wires the controller once Tyrol's machine lands. Tigh writes the unit tests
against the contract now, and the e2e once Starbuck wires the app.

## Tests (Tigh)

Unit (`tests/unit/tutorial.test.ts`, Node, real engine, no mocks of `src/game`):
- **Script integrity.** Step ids are exactly `TutorialStepId` in order, every lesson is used, each page is at most
  138 chars, and every character matches `/^[A-Z0-9 \-+.,:!?'\/<>=%()#]*$/`. Every action step's `expect` is in
  `legalActions` of the scripted state at that step (step 13 excepted, where `avoidRoom` must be refused with
  `cannotAvoidTwice`).
- **Golden playthrough.** Drive `createGame(tutorialGameOptions())` and the machine with the canonical moves. Assert
  each step advances exactly once, on the documented trigger. The HP trace after each room is 20, 20, 10, 14, 10,
  20. The end is `GameWon` with score 30, then `recap`.
- **Gate.** At every step, every other legal action and every non-expected `select` is blocked with a non-empty
  nudge, and feeding `blocked` does not advance. The `enterRoom` harmless rule holds. Specific nudges take
  precedence. Blocked moves never change `session.history`.
- **NEXT semantics.** Paging works, and NEXT is a no-op on the last page of an action step. Acting early on page 1
  of `r4Drink` completes it.
- **Desync.** A `GameLost` batch, or a missing expected card, sends the machine to `desynced`.
- **Determinism and purity.** `startTutorial()` and `createGame(tutorialGameOptions())` are deep-equal across calls,
  states stay deep-frozen safe, and replaying the canonical log reproduces the final state.

Deck option (`tests/unit/deckOption.test.ts`): no shuffle and the RNG is never called (spy factory); the first 4
cards are dealt in order; `deckSize` is the deck length; duplicate ids or an empty deck throw `RangeError`;
`replay` is equal.

E2E (`tests/e2e/tutorial.spec.ts`, desktop and Pixel 7):
- With fresh storage, the offer is shown. Press Enter, then play the whole tutorial by keyboard. Before each key,
  wait for `#coach-live[data-ready="true"][data-step="<id>"]`. Canonical keys: `Enter Enter | Enter | Enter |
  Enter | Enter Enter | 1 | 2 W | Enter | 4 | Enter Enter | Enter Enter | A | A | Enter | 1 W | Enter Enter | 2 |
  3 W | Enter 4 | 2 | Enter | 1 | Enter | Enter Enter | 1 W | 2 W | 4 W | Enter | 3 W | 1`. Then
  `data-phase="recap"`, and Enter starts a real run (`data-phase` absent).
- A wrong move (`3` on `r1Equip`) shows a nudge in `#coach-live`, and the step stays the same.
- Reload: no offer (`tutorialSeen` persisted). `X` mid-tutorial returns to the title.
- Reduced-motion variant (`reducedMotion: 'reduce'`) completes with the same keys.
- Update `smoke.spec.ts` for the offer (fresh storage now shows it). Any future real-run e2e seeds
  `tutorialSeen: true` with `addInitScript` or presses Esc.

## Out of scope

Localisation, voice-over, a free-play sandbox, rule-variant tutorials (`'lt'`, `'deckOnly'`), and analytics on
tutorial completion.
