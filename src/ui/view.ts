/**
 * Shared presentation types: the read model render draws, the layout FX animates toward, and
 * the intents input produces. CONTRACT. Owner: Starbuck. Consumers: render/, fx/, ui/.
 *
 * Neutral home for types that render/ and fx/ both need, so neither imports the other's internals.
 * Depends on game/ for types only.
 */
import { notImplemented } from '../notImplemented';
import type { Card, CardId, FightMode, GameState, Phase } from '../game';

/** Logical-pixel rectangle (pre-upscale, see render/types.ts LOGICAL_*). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type ButtonId = 'enter' | 'avoid' | 'fightWeapon' | 'fightBarehanded' | 'cancel' | 'newGame' | 'mute' | 'settings';

/** Per-room-card affordances, precomputed so render never re-implements rules. */
export interface RoomCardView {
  readonly card: Card;
  readonly slot: number;
  readonly playable: boolean;
  /** For monsters: whether the weapon option is available, and the HP cost of each option. */
  readonly canUseWeapon: boolean;
  readonly damageWithWeapon: number | null;
  readonly damageBarehanded: number | null;
  /** For potions: true if playing it now would be wasted (second potion this room). */
  readonly potionWouldBeWasted: boolean;
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
}

/** UI-local state that is not part of the game (selection, menus). Owned by ui/. */
export interface UiLocalState {
  readonly pendingFight: CardId | null;
  readonly menuOpen: boolean;
}

/** Build the view model. Pure; uses engine query functions (canAvoidRoom, canUseWeaponOn, previewDamage...). */
export function selectView(_state: GameState, _ui: UiLocalState): GameView {
  return notImplemented('selectView', 'Starbuck');
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
}

/** What a pointer is over. Produced by Renderer.hitTest. */
export type HitTarget =
  | { readonly kind: 'card'; readonly cardId: CardId }
  | { readonly kind: 'button'; readonly id: ButtonId }
  | { readonly kind: 'weapon' }
  | { readonly kind: 'deck' };

/**
 * Player intents from input (pointer, touch, keyboard). ui/ maps intents to GameActions or UI-local changes.
 * Keyboard: 1-4 select room slot, W/B choose weapon/barehanded, A avoid, Enter enter, M mute, N new game.
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
  | { readonly type: 'hover'; readonly target: HitTarget | null };
