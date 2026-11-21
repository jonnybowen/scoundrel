/**
 * Shared presentation types: the read model render draws, the layout FX animates toward, and
 * the intents input produces. CONTRACT. Owner: Starbuck. Consumers: render/, fx/, ui/.
 *
 * Neutral home for types that render/ and fx/ both need, so neither imports the other's internals.
 * Depends on game/ (types, plus engine query functions inside selectView only).
 *
 * Additive changes after Design Review 1 (decision recorded by Starbuck): ButtonId gained settings-menu ids,
 * UiIntent gained settings/skip intents, GameView gained `resolvedThisRoom` + `chrome`, UiLocalState gained
 * screen/hover/toast/result/settings fields, and selectView accepts `null` (title screen, no game yet).
 * Review-gate additions (pre-approved by Adama): GameView.cardsLeftToResolve, RoomCardView.kind, RoomCardView.lethal,
 * so render reads rule outcomes instead of deriving them.
 * Design Review 2 (tutorial, Adama): tutorial ButtonIds and UiIntents, optional ViewChrome.tutorial /
 * tutorialOffer, optional LayoutSnapshot.regions / coach. All optional, so the running app is unaffected until wired.
 */
import {
  MAX_HP,
  DECK_SIZE,
  CARDS_RESOLVED_PER_ROOM,
  canAvoidRoom,
  canUseWeaponOn,
  cardKind,
  computeScore,
  legalActions,
  previewDamage,
  weaponLimit,
} from '../game';
import type { Card, CardId, CardKind, FightMode, GameState, Phase } from '../game';
import type { Settings } from './settings';
import type { CoachControlId, RegionId, TutorialChrome } from '../tutorial';

/** Logical-pixel rectangle (pre-upscale, see render/types.ts LOGICAL_*). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type ButtonId =
  | 'enter'
  | 'avoid'
  | 'fightWeapon'
  | 'fightBarehanded'
  | 'cancel'
  | 'newGame'
  | 'mute'
  | 'settings'
  // Settings menu (additive, Starbuck):
  | 'crt'
  | 'motion'
  | 'volDown'
  | 'volUp'
  | 'closeMenu'
  // Tutorial (Design Review 2):
  /** Title screen: start the tutorial. */
  | 'tutorial'
  /** First-launch offer: "TEACH ME" / "I KNOW THE RULES". */
  | 'tutorialAccept'
  | 'tutorialDecline'
  /** Coach panel: next page / leave the tutorial (also the settings-menu row while in the tutorial). */
  | 'tutorialNext'
  | 'tutorialSkip'
  /** Recap screen. */
  | 'tutorialPlayReal'
  | 'tutorialReplay';

/** Compile-time check: every coach control the tutorial can spotlight is a real ButtonId. */
type _CoachControlsAreButtons = CoachControlId extends ButtonId ? true : never;
export const COACH_CONTROLS_ARE_BUTTONS: _CoachControlsAreButtons = true;

/** Per-room-card affordances, precomputed so render never re-implements rules. */
export interface RoomCardView {
  readonly card: Card;
  readonly slot: number;
  /** Engine card kind (cardKind). The UI branches on this; it never maps suits itself. */
  readonly kind: CardKind;
  readonly playable: boolean;
  /** For monsters: whether the weapon option is available, and the HP cost of each option. */
  readonly canUseWeapon: boolean;
  readonly damageWithWeapon: number | null;
  /** Non-null exactly when the card is a monster. */
  readonly damageBarehanded: number | null;
  /** For potions: true if playing it now would be wasted (second potion this room). */
  readonly potionWouldBeWasted: boolean;
  /** For monsters: every fight option available now would reduce HP to 0. False for non-monsters and after game over. */
  readonly lethal: boolean;
}

/** Which full-screen state the UI is in. 'title' has no game yet. */
export type Screen = 'title' | 'game';

/** UI chrome the renderer needs that is not game state: menus, hover, toasts, settings readouts. */
export interface ViewChrome {
  readonly screen: Screen;
  readonly menuOpen: boolean;
  readonly hover: HitTarget | null;
  /** Short message (rule violation, setting change). */
  readonly toast: string | null;
  /** Game-over / win panel is visible (set once FX finished presenting the final batch). */
  readonly showResult: boolean;
  readonly settings: Settings;
  /** Non-null when the game could not start (e.g. engine unavailable). Shown on the title screen. */
  readonly error: string | null;
  /**
   * Design Review 2: present (non-null) only while the tutorial runs (screen stays 'game'). Coach panel, spotlight,
   * arrow and recap are drawn from this alone. The app latches it while fx.isBusy() (docs/TUTORIAL.md "FX timing").
   * When set, render suppresses the normal hint line and the normal result panel.
   */
  readonly tutorial?: TutorialChrome | null;
  /** Design Review 2: title screen shows the first-launch "learn to play?" offer (settings.tutorialSeen false). */
  readonly tutorialOffer?: boolean;
}

/**
 * Immutable snapshot of everything the screen shows, derived from GameState via engine queries.
 * Render draws ONLY from GameView + FxFrame. It never reads GameState directly and never applies rules.
 */
export interface GameView {
  readonly phase: Phase;
  readonly hp: number;
  readonly maxHp: number;
  readonly deckCount: number;
  readonly discardCount: number;
  readonly roomNumber: number;
  /** 4 slots; null = empty. */
  readonly room: readonly (RoomCardView | null)[];
  readonly weapon: { readonly card: Card; readonly slain: readonly Card[]; readonly limit: number | null } | null;
  readonly canAvoid: boolean;
  readonly canEnter: boolean;
  readonly score: number | null;
  /** UI-local selection (e.g. monster awaiting weapon/barehanded choice). Not game state. */
  readonly pendingFight: CardId | null;
  /** Cards resolved in the current room. */
  readonly resolvedThisRoom: number;
  /**
   * Cards the player must still resolve before the room clears (CARDS_RESOLVED_PER_ROOM per room; every
   * remaining card in the final room, when the deck is empty). 0 on the title screen and once the game is over.
   */
  readonly cardsLeftToResolve: number;
  readonly chrome: ViewChrome;
}

/** UI-local state that is not part of the game (selection, menus). Owned by ui/. */
export interface UiLocalState {
  readonly pendingFight: CardId | null;
  readonly menuOpen: boolean;
  readonly screen: Screen;
  readonly hover: HitTarget | null;
  readonly toast: string | null;
  readonly showResult: boolean;
  readonly settings: Settings;
  readonly error: string | null;
  /** Design Review 2: see ViewChrome.tutorial / tutorialOffer. */
  readonly tutorial?: TutorialChrome | null;
  readonly tutorialOffer?: boolean;
}

function chromeOf(ui: UiLocalState): ViewChrome {
  return {
    screen: ui.screen,
    menuOpen: ui.menuOpen,
    hover: ui.hover,
    toast: ui.toast,
    showResult: ui.showResult,
    settings: ui.settings,
    error: ui.error,
    ...(ui.tutorial !== undefined ? { tutorial: ui.tutorial } : {}),
    ...(ui.tutorialOffer !== undefined ? { tutorialOffer: ui.tutorialOffer } : {}),
  };
}

/**
 * Build the view model. Pure; uses engine query functions (canAvoidRoom, canUseWeaponOn, previewDamage...).
 * `state === null` yields the empty title-screen view.
 */
export function selectView(state: GameState | null, ui: UiLocalState): GameView {
  if (!state || ui.screen === 'title') {
    return {
      phase: 'choosing',
      hp: MAX_HP,
      maxHp: MAX_HP,
      deckCount: DECK_SIZE,
      discardCount: 0,
      roomNumber: 0,
      room: [null, null, null, null],
      weapon: null,
      canAvoid: false,
      canEnter: false,
      score: null,
      pendingFight: null,
      resolvedThisRoom: 0,
      cardsLeftToResolve: 0,
      chrome: chromeOf(ui),
    };
  }

  const over = state.phase === 'won' || state.phase === 'lost';
  const legal = over ? [] : legalActions(state);
  const playableIds = new Set<CardId>();
  let canEnter = false;
  for (const a of legal) {
    if (a.type === 'playCard') playableIds.add(a.cardId);
    else if (a.type === 'enterRoom') canEnter = true;
  }

  const room = state.room.map((card, slot): RoomCardView | null => {
    if (!card) return null;
    const kind = cardKind(card);
    const isMonster = kind === 'monster';
    const isPotion = kind === 'potion';
    const canUseWeapon = !over && isMonster && state.weapon !== null && canUseWeaponOn(state, card.id);
    const damageWithWeapon = canUseWeapon ? previewDamage(state, card, 'weapon') : null;
    const damageBarehanded = isMonster ? previewDamage(state, card, 'barehanded') : null;
    // Lethal when the cheapest available option still takes all remaining HP.
    const cheapest = damageBarehanded === null ? null : Math.min(damageBarehanded, damageWithWeapon ?? Infinity);
    return {
      card,
      slot,
      kind,
      playable: playableIds.has(card.id),
      canUseWeapon,
      damageWithWeapon,
      damageBarehanded,
      potionWouldBeWasted: isPotion && state.potionUsedThisRoom,
      lethal: !over && cheapest !== null && cheapest >= state.hp,
    };
  });

  // Room clears after CARDS_RESOLVED_PER_ROOM resolutions, except the final room (deck empty), which must be
  // resolved completely (engine.ts room completion, RULES.md A4).
  const inRoom = room.filter((r) => r !== null).length;
  const finalRoom = state.deck.length === 0;
  const cardsLeftToResolve = over
    ? 0
    : finalRoom
      ? inRoom
      : Math.max(0, Math.min(CARDS_RESOLVED_PER_ROOM - state.resolvedThisRoom, inRoom));

  const pending = ui.pendingFight !== null && room.some((r) => r?.card.id === ui.pendingFight) ? ui.pendingFight : null;

  return {
    phase: state.phase,
    hp: state.hp,
    maxHp: state.maxHp,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    roomNumber: state.roomNumber,
    room,
    weapon: state.weapon ? { card: state.weapon.card, slain: state.weapon.slain, limit: weaponLimit(state) } : null,
    canAvoid: !over && canAvoidRoom(state),
    canEnter,
    score: state.score ?? computeScore(state),
    pendingFight: over ? null : pending,
    resolvedThisRoom: state.resolvedThisRoom,
    cardsLeftToResolve,
    chrome: chromeOf(ui),
  };
}

/** Home positions for every visible card and button for the current view + viewport. Pure. */
export interface LayoutSnapshot {
  readonly cards: ReadonlyMap<CardId, Rect>;
  readonly deck: Rect;
  readonly discard: Rect;
  readonly weapon: Rect;
  readonly hpMeter: Rect;
  readonly buttons: ReadonlyMap<ButtonId, Rect>;
  /** 'portrait' on phones, 'landscape' on desktop; layout differs, rules do not. */
  readonly orientation: 'portrait' | 'landscape';
  /** Design Review 2: rects for coach spotlight regions (hp, score, weaponLimit...). Present while the tutorial runs. */
  readonly regions?: ReadonlyMap<RegionId, Rect>;
  /** Design Review 2: the coach panel rect (or recap panel). Present while the tutorial runs. */
  readonly coach?: Rect;
  /**
   * Logical canvas size for this layout (viewport-dependent: short side 270, long side 480..660 by aspect).
   * Absent = the 16:9 base size for the orientation (480x270 / 270x480).
   */
  readonly logical?: { readonly w: number; readonly h: number };
  /** Safe content box in logical px (clear of display cutout / gesture bar). Absent = the whole canvas. */
  readonly safe?: Rect;
}

/** What a pointer is over. Produced by Renderer.hitTest. */
export type HitTarget =
  | { readonly kind: 'card'; readonly cardId: CardId }
  | { readonly kind: 'button'; readonly id: ButtonId }
  | { readonly kind: 'weapon' }
  | { readonly kind: 'deck' };

/**
 * Player intents from input (pointer, touch, keyboard). ui/ maps intents to GameActions or UI-local changes.
 * Keyboard: 1-4 select room slot, W/B choose weapon/barehanded, A avoid, Enter enter, M mute, N new game,
 * Esc cancel/close, S settings, C toggle CRT, Space skip animation.
 */
export type UiIntent =
  | { readonly type: 'selectCard'; readonly cardId: CardId }
  | { readonly type: 'chooseFight'; readonly mode: FightMode }
  | { readonly type: 'cancel' }
  | { readonly type: 'enterRoom' }
  | { readonly type: 'avoidRoom' }
  | { readonly type: 'newGame'; readonly seed?: number }
  | { readonly type: 'toggleMute' }
  | { readonly type: 'openSettings' }
  | { readonly type: 'hover'; readonly target: HitTarget | null }
  // Additive (Starbuck):
  | { readonly type: 'closeSettings' }
  | { readonly type: 'toggleCrt' }
  | { readonly type: 'toggleReducedMotion' }
  | { readonly type: 'changeVolume'; readonly delta: number }
  | { readonly type: 'skip' }
  // Tutorial (Design Review 2). Keys: T start (title), Enter/ArrowRight next (info pages only; otherwise Enter
  // keeps meaning enterRoom), X leave, and on the offer Enter accept / Esc decline; on the recap Enter play a
  // real run, R replay, Esc title.
  /** Start (or restart) the tutorial. Marks settings.tutorialSeen. Also the offer's "TEACH ME". */
  | { readonly type: 'tutorialStart' }
  /** Next coach page / complete an info step. Gated by fx.isBusy() like game actions (busy -> fx.skip()). */
  | { readonly type: 'tutorialNext' }
  /** Leave the tutorial for the title screen. Marks tutorialSeen. No confirmation; restart is one tap away. */
  | { readonly type: 'tutorialSkip' }
  /** First-launch offer: "I KNOW THE RULES". Marks tutorialSeen, stays on the title. */
  | { readonly type: 'tutorialDecline' }
  /** Recap: "PLAY A REAL RUN" -> a normal newGame with a random seed. */
  | { readonly type: 'tutorialPlayReal' };
