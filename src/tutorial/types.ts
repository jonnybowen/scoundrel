/**
 * Interactive tutorial. CONTRACT (Design Review 2, Adama 2026-11-20). Impl owner: Tyrol.
 * Consumers: ui/ (Starbuck: controller, view, input), render/ (Starbuck: coach panel), fx/ + audio/ (Gaeta: cues),
 * tests (Tigh). See docs/TUTORIAL.md for the lesson script these types encode.
 *
 * Principles:
 * - The REAL engine is the only rules authority. The tutorial never forks a rule. It picks the deck order
 *   (createGame({ deck })), filters which legal actions the player may take right now (gate), and
 *   listens to the engine's events and violations to decide when a step is complete.
 * - Pure and DOM-free, like src/game (src/tutorial is in tsconfig.game.json's purity gate). It imports only
 *   from src/game (the index; stubs use game/notImplemented). ui/ imports it; it never imports ui/.
 * - TutorialState is plain JSON. Every function is a pure function of its inputs.
 */
import type { CardId, FightMode, GameAction, GameEvent, GameState, RuleViolation } from '../game';

// ---------------------------------------------------------------------------------------------
// Script identity
// ---------------------------------------------------------------------------------------------

/** Lessons group steps for the "LESSON n/7" progress readout. */
export type LessonId = 'cards' | 'rooms' | 'avoiding' | 'dulling' | 'potions' | 'stakes' | 'finalRoom';

export const LESSONS: readonly LessonId[] = ['cards', 'rooms', 'avoiding', 'dulling', 'potions', 'stakes', 'finalRoom'];

/** One id per scripted step, in script order (docs/TUTORIAL.md, "Lesson script"). */
export type TutorialStepId =
  // Lesson 1: the cards (room 1, choosing)
  | 'welcome'
  | 'monsters'
  | 'weapons'
  | 'potions'
  // Lesson 2: rooms (room 1)
  | 'roomRule'
  | 'r1Equip'
  | 'r1Fight'
  | 'r1FightDone'
  | 'r1Potion'
  | 'r1Cleared'
  // Lesson 3: avoiding (rooms 2-3)
  | 'r2Look'
  | 'r2Avoid'
  | 'r3TryAvoid'
  | 'r3Refused'
  // Lesson 4: weapons dull (room 3)
  | 'r3Fight6'
  | 'r3Dull'
  | 'r3TooDull'
  | 'r3Fight4'
  // Lesson 5: potions (room 4)
  | 'r4Drink'
  | 'r4Waste'
  | 'r4Wasted'
  | 'r4NewWeapon'
  // Lesson 6: winning and losing (room 5)
  | 'r5Return'
  | 'r5Losing'
  | 'r5Ace'
  | 'r5Seven'
  | 'r5Three'
  // Lesson 7: the final room (room 6)
  | 'r6Final'
  | 'r6Two'
  | 'r6Potion';

/**
 * The scripted dungeon, top of the deck first (card ids per cardIdOf). Passed to createGame({ deck }) as Cards.
 * 14 cards; the 4 avoided in room 2 return as rooms 5-6. Final score is 30 (20 HP + 10 potion bonus).
 * Must stay in sync with docs/TUTORIAL.md "Scripted dungeon". Tigh's tests replay the script against it.
 */
export const TUTORIAL_DECK_ORDER: readonly CardId[] = [
  'D5', 'S8', 'C3', 'H5', // room 1
  'S14', 'C7', 'H10', // room 2 refill (C3 carried), avoided
  'S6', 'C9', 'C4', 'H4', // room 3 (fresh deal after the avoid)
  'D10', 'H2', 'C2', // room 4 refill (H4 carried)
];

/** Fixed seed recorded on the tutorial GameState. Unused for shuffling (the deck is given). */
export const TUTORIAL_SEED = 0x5c0d;

// ---------------------------------------------------------------------------------------------
// Script schema (data authored by Tyrol in src/tutorial/script.ts)
// ---------------------------------------------------------------------------------------------

/** Board areas the coach can point at. Starbuck's layout supplies a Rect for each (LayoutSnapshot.regions). */
export type RegionId = 'hp' | 'score' | 'deck' | 'discard' | 'room' | 'weapon' | 'weaponLimit' | 'slainStack';

/** On-screen game controls the coach can point at. Each is also a ui ButtonId (checked in ui/view.ts). */
export type CoachControlId = 'avoid' | 'fightWeapon' | 'fightBarehanded';

export type SpotlightTarget =
  | { readonly kind: 'card'; readonly cardId: CardId }
  | { readonly kind: 'control'; readonly id: CoachControlId }
  | { readonly kind: 'region'; readonly id: RegionId };

/** Matches one GameAction the step expects. `mode` is compared after normalisation (see gate). */
export type ActionMatcher =
  | { readonly type: 'enterRoom' }
  | { readonly type: 'avoidRoom' }
  | { readonly type: 'playCard'; readonly cardId: CardId; readonly mode?: FightMode };

/** What completes a step. */
export type StepTrigger =
  /** Info step: the player presses NEXT on its last page. */
  | { readonly kind: 'next' }
  /** An accepted batch contains an event of this type (optionally about this card). */
  | { readonly kind: 'event'; readonly event: GameEvent['type']; readonly cardId?: CardId }
  /** The engine REFUSED the expected action with this violation (used once: avoiding twice). */
  | { readonly kind: 'violation'; readonly code: RuleViolation['code'] };

export interface TutorialStep {
  readonly id: TutorialStepId;
  readonly lesson: LessonId;
  /** Short heading, e.g. "WEAPONS DULL". Upper case, at most 20 chars. */
  readonly title: string;
  /**
   * Coach text pages. Pixel-font rules: characters the 3x5 font has (A-Z 0-9 space - + . , : ! ? ' / < > = % ( ) #),
   * at most 138 chars per page (3 lines of 46). Render wraps; the script never relies on lower case.
   */
  readonly pages: readonly string[];
  readonly spotlight: readonly SpotlightTarget[];
  /** Draw a pointer arrow from the coach panel to spotlight[0]. */
  readonly arrow: boolean;
  /** Action steps: the only action that may be dispatched (plus harmless enterRoom, see gate rules). */
  readonly expect: ActionMatcher | null;
  readonly until: StepTrigger;
  /** Shown in the coach panel when the player tries anything else. Gentle, never punitive. */
  readonly nudge: string;
  /** Optional extra nudges for specific wrong moves, checked before `nudge`. */
  readonly nudges?: readonly { readonly when: ActionMatcher; readonly text: string }[];
}

// ---------------------------------------------------------------------------------------------
// Step machine state + I/O
// ---------------------------------------------------------------------------------------------

export type TutorialPhase =
  /** Coaching on the board. */
  | 'coaching'
  /** GameWon landed: recap screen with "PLAY A REAL RUN". */
  | 'recap'
  /** The game state no longer matches the script (should be impossible with gating). Coach offers a restart. */
  | 'desynced';

/** Plain JSON. */
export interface TutorialState {
  readonly phase: TutorialPhase;
  readonly stepIndex: number;
  /** Current page within the step's pages. */
  readonly page: number;
  /** Nudge text currently shown, or null. Cleared on any successful advance or NEXT. */
  readonly nudge: string | null;
  /** Bumped on every blocked attempt, so fx/audio can re-trigger the nudge cue for repeated mistakes. */
  readonly nudgeSerial: number;
}

/** What the player is trying to do. 'select' is a card tap that only opens the weapon/fists choice (UI-local). */
export type TutorialQuery = GameAction | { readonly type: 'select'; readonly cardId: CardId };

export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly nudge: string };

/** Inputs the step machine reacts to. */
export type TutorialInput =
  | { readonly type: 'next' }
  /** An accepted engine transition (the batch the session broadcast) and the resulting state. */
  | { readonly type: 'events'; readonly events: readonly GameEvent[]; readonly state: GameState }
  /** The engine rejected an action the gate had allowed. */
  | { readonly type: 'violation'; readonly violation: RuleViolation; readonly state: GameState }
  /** The gate refused a query; record its nudge. */
  | { readonly type: 'blocked'; readonly nudge: string };

// ---------------------------------------------------------------------------------------------
// Views (consumed by ui/view.ts -> render)
// ---------------------------------------------------------------------------------------------

/** The coach panel, spotlight and arrow, for one frame. Text is final; render only wraps and draws it. */
export interface CoachView {
  readonly stepId: TutorialStepId;
  /** 1-based lesson number and total, for "LESSON 3/7". */
  readonly lesson: number;
  readonly lessonCount: number;
  readonly title: string;
  /** Current page text (unwrapped). */
  readonly text: string;
  readonly page: number;
  readonly pageCount: number;
  /** Show the NEXT button (info steps, and every page but the last of an action step). */
  readonly showNext: boolean;
  /** Gentle feedback after a blocked move; render shows it in place of / under the text. */
  readonly nudge: string | null;
  readonly nudgeSerial: number;
  readonly spotlight: readonly SpotlightTarget[];
  readonly arrow: boolean;
  /** Dim the board outside the spotlight. False when the spotlight is empty. */
  readonly dim: boolean;
}

export interface RecapView {
  readonly title: string;
  /** One line per concept taught (docs/TUTORIAL.md "Recap"). */
  readonly lines: readonly string[];
  /** Final score of the scripted run (30) and its breakdown text, e.g. "20 HP + 10 POTION BONUS". */
  readonly score: number;
  readonly scoreText: string;
}

/** Everything ui/ puts in GameView.chrome.tutorial. */
export interface TutorialChrome {
  readonly phase: TutorialPhase;
  /** Non-null while coaching (and in 'desynced', with restart text). */
  readonly coach: CoachView | null;
  /** Non-null in 'recap'. */
  readonly recap: RecapView | null;
}
