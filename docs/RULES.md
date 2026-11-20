# Scoundrel rules (canonical for this project)

Scoundrel is a single-player rogue-like card game by Zach Gage and Kurt Bieg (2011). This file is the
single source of truth for the rules engine (`src/game`, owner Tyrol) and the rules tests (owner Tigh).
Where the published rules are ambiguous, the **Ambiguities** section records the ruling we picked.
Changing a ruling needs a team decision.

Source checked: the official rules text as reproduced at rulespal.com/scoundrel/rulebook (Nov 2026).

## Setup

- Start with a standard 52-card deck. Remove the jokers, the red face cards (J, Q, K of hearts and diamonds) and the red aces.
- That leaves **44 cards**, shuffled face down. This pile is the **Dungeon**.
- You start with **20 health**. Health can never go above 20.

## Cards

| Suit | Count | Role | Value |
|------|-------|------|-------|
| Clubs, spades | 26 (2 to A each) | Monster | Face value; J=11, Q=12, K=13, A=14. Damage dealt. |
| Diamonds | 9 (2 to 10) | Weapon | Face value. Reduces damage from monsters. |
| Hearts | 9 (2 to 10) | Health potion | Face value. Restores health. |

## Turn structure

1. **Deal a room.** Flip cards from the top of the Dungeon until there are 4 face up. This is the **Room**.
2. **Avoid or face.** You may **avoid** the Room: all 4 cards go to the bottom of the Dungeon, and you deal
   a new Room. You may avoid as many Rooms as you like, but **never two Rooms in a row**.
   You decide before resolving any card in the Room.
3. **Face the room.** Choose **3 of the 4** cards, one at a time, and resolve each (see below).
   The 4th card stays face up and becomes part of the next Room.
4. Deal 3 more cards to refill the Room to 4 and repeat.

## Resolving cards

### Weapon (diamond)

You must equip it. Any previously equipped weapon is discarded, together with every monster stacked on it.

### Health potion (heart)

Add its value to your health, capped at 20. **Only one potion per turn (Room) heals.** If you take a second
potion in the same Room, it is discarded with no effect.

### Monster (club or spade)

Choose how to fight it:

- **Barehanded:** take the monster's full value as damage. The monster is discarded.
- **With your weapon:** take `max(0, monster - weapon)` damage. The monster is placed on the weapon's stack.

**Weapon degradation.** An unused weapon can fight any monster. Once it has slain a monster, it can only be used
on monsters whose value is **less than or equal to** the value of the **last** monster it slew (see A1).
Example: a 5 weapon slays a Queen (12). It can then fight a 6. After that it can only fight monsters of
6 or lower. A later Queen must be fought barehanded. The weapon stays equipped; it is not discarded.

Fighting barehanded is always allowed, even when the weapon could be used.

## End of game and scoring

The game ends when your health reaches **0** (loss) or you resolve the entire Dungeon (win).

- **Loss:** find all remaining monsters in the Dungeon and subtract their values from your health.
  The (negative) result is your score.
- **Win:** your score is your remaining health. **Bonus:** if your health is 20 and the last card you resolved
  was a health potion, your score is 20 + that potion's value.

## Ambiguities and rulings (for Tyrol)

Each ruling below is the default. Items marked *(option)* are switchable through `RulesOptions` in `src/game/state.ts`.

**A1. Weapon limit: `<=` or `<`?** *(option `weaponLimit`, default `'lte'`)*
The official text says "Monsters of a lower value (less than or equal) than the previous Monster it had slain".
"Lower" and "less than or equal" contradict each other, and many digital versions and summaries use strict `<`. We default to `<=` (the explicit wording) and keep `'lt'` as a variant.

**A2. Weapon limit compares against the last monster slain, not the weapon's value or the strongest monster slain.**
This is clear in the text but commonly misread; tests must cover it, including the "5 weapon, Queen, then 6" example.

**A3. Which monsters count against a losing score?** *(option `lossScoreScope`, default `'dungeon'`)*
"Remaining monsters in the Dungeon" could mean only the draw pile or the draw pile plus unresolved cards in the
current Room. Default: draw pile plus unresolved Room cards. The monster that killed you has been resolved and does not count.

**A4. End of the Dungeon.** The deck does not divide evenly (4 + 3n), and avoids do not change the deck count.
Ruling: if the Dungeon is empty after dealing, the Room is the **final Room**. It may hold fewer than 4 cards,
it cannot be avoided, and **all** its cards must be resolved (no carry-over). Clearing it wins the game.

**A5. Avoiding with a carried-over card.** The carried card is part of the Room, so all 4 go to the bottom
(order: slot order, left to right). Avoiding is only possible before resolving any card in the Room.

**A6. Health below 0.** Health is clamped at 0 when you die; overkill does not reduce the losing score further.
The `DamageTaken` event still reports the full damage amount.

**A7. Potion at full health.** It still counts as this Room's one potion (it heals 0). A second potion that Room is wasted.

**A8. Win bonus with a wasted potion.** If the last card resolved was a potion that was wasted (second in a Room)
and health is 20, the bonus still applies: the text says "your last card was a health potion" with no qualifier.
Low-stakes; revisit if playtesting disagrees.

**A9. Weapon choice when both options are legal.** The engine never chooses for the player. A `playCard` on a
monster with no `mode`, while the weapon could fight it, is rejected with `modeRequired`; the UI asks.

**A10. Room counting.** `roomNumber` increments on every deal, including after an avoid. It is cosmetic only.
