/**
 * The lesson script as data: one TutorialStep per TutorialStepId, in order. Impl owner: Tyrol.
 * Source of truth for the words and gates is docs/TUTORIAL.md "Lesson script"; keep them in sync.
 * The scripted deck is TUTORIAL_DECK_ORDER in ./types.
 */
import type { CardId, FightMode } from '../game';
import type {
  ActionMatcher,
  CoachControlId,
  LessonId,
  RecapView,
  RegionId,
  SpotlightTarget,
  StepTrigger,
  TutorialStep,
  TutorialStepId,
} from './types';

// ---------------------------------------------------------------------------------------------
// Builders (keep the table below readable)
// ---------------------------------------------------------------------------------------------

const card = (cardId: CardId): SpotlightTarget => ({ kind: 'card', cardId });
const control = (id: CoachControlId): SpotlightTarget => ({ kind: 'control', id });
const region = (id: RegionId): SpotlightTarget => ({ kind: 'region', id });

const play = (cardId: CardId, mode?: FightMode): ActionMatcher =>
  mode === undefined ? { type: 'playCard', cardId } : { type: 'playCard', cardId, mode };
const AVOID: ActionMatcher = { type: 'avoidRoom' };

const NEXT: StepTrigger = { kind: 'next' };
const on = (event: Extract<StepTrigger, { kind: 'event' }>['event'], cardId?: CardId): StepTrigger =>
  cardId === undefined ? { kind: 'event', event } : { kind: 'event', event, cardId };

const NEXT_NUDGE = 'PRESS NEXT (ENTER) TO CONTINUE.';

const LESSON_TITLES: Readonly<Record<LessonId, string>> = {
  cards: 'THE CARDS',
  rooms: 'ROOMS',
  avoiding: 'AVOIDING',
  dulling: 'WEAPONS DULL',
  potions: 'POTIONS',
  stakes: 'WINNING AND LOSING',
  finalRoom: 'THE FINAL ROOM',
};

interface StepSpec {
  readonly id: TutorialStepId;
  readonly lesson: LessonId;
  readonly pages: readonly string[];
  readonly spotlight: readonly SpotlightTarget[];
  readonly expect?: ActionMatcher;
  readonly until?: StepTrigger;
  readonly nudge?: string;
  readonly nudges?: readonly { readonly when: ActionMatcher; readonly text: string }[];
}

function build(s: StepSpec): TutorialStep {
  const step: TutorialStep = {
    id: s.id,
    lesson: s.lesson,
    title: LESSON_TITLES[s.lesson],
    pages: s.pages,
    spotlight: s.spotlight,
    // Every step in docs/TUTORIAL.md marks its first spotlight target with an arrow.
    arrow: s.spotlight.length > 0,
    expect: s.expect ?? null,
    until: s.until ?? NEXT,
    nudge: s.nudge ?? NEXT_NUDGE,
  };
  return s.nudges ? { ...step, nudges: s.nudges } : step;
}

// ---------------------------------------------------------------------------------------------
// The script (docs/TUTORIAL.md "Lesson script", steps 1-30)
// ---------------------------------------------------------------------------------------------

const SAVE_POTION = 'SAVE THE POTION. IT WILL STAY FOR THE NEXT ROOM.';

const SPECS: readonly StepSpec[] = [
  // Lesson 1/7: THE CARDS (room 1, choosing)
  {
    id: 'welcome',
    lesson: 'cards',
    pages: [
      'WELCOME, SCOUNDREL. THIS DECK IS THE DUNGEON. GET THROUGH EVERY CARD ALIVE AND YOU WIN.',
      'YOU START WITH 20 HP. HERE IS YOUR HEALTH.',
    ],
    spotlight: [region('deck'), region('hp')],
  },
  {
    id: 'monsters',
    lesson: 'cards',
    pages: ['CLUBS AND SPADES ARE MONSTERS. A MONSTER HITS YOU FOR ITS VALUE. J=11 Q=12 K=13 A=14.'],
    spotlight: [card('S8'), card('C3')],
  },
  {
    id: 'weapons',
    lesson: 'cards',
    pages: ['DIAMONDS ARE WEAPONS. A WEAPON BLOCKS AS MUCH DAMAGE AS ITS VALUE.'],
    spotlight: [card('D5')],
  },
  {
    id: 'potions',
    lesson: 'cards',
    pages: ['HEARTS ARE POTIONS. THEY HEAL BY THEIR VALUE, BUT NEVER ABOVE 20 HP.'],
    spotlight: [card('H5'), region('hp')],
  },

  // Lesson 2/7: ROOMS (room 1)
  {
    id: 'roomRule',
    lesson: 'rooms',
    pages: [
      'THESE 4 CARDS ARE A ROOM. FACE IT BY PLAYING 3 OF THEM, ONE AT A TIME, IN ANY ORDER.',
      'THE 4TH CARD STAYS BEHIND AND JOINS THE NEXT ROOM.',
    ],
    spotlight: [region('room')],
  },
  {
    id: 'r1Equip',
    lesson: 'rooms',
    pages: ['START WITH THE WEAPON. TAP THE 5 OF DIAMONDS, OR PRESS 1.'],
    spotlight: [card('D5')],
    expect: play('D5'),
    until: on('WeaponEquipped', 'D5'),
    nudge: 'FIRST, PICK UP THE 5 OF DIAMONDS (KEY 1).',
    nudges: [{ when: AVOID, text: 'NO RUNNING YET. WE WILL TRY AVOIDING SOON.' }],
  },
  {
    id: 'r1Fight',
    lesson: 'rooms',
    pages: ['NOW FIGHT THE 8 OF SPADES. TAP IT (KEY 2), THEN PICK THE SWORD (KEY W).'],
    spotlight: [card('S8'), control('fightWeapon')],
    expect: play('S8', 'weapon'),
    until: on('MonsterSlain', 'S8'),
    nudge: 'TAP THE 8 OF SPADES (KEY 2), THEN THE SWORD (W).',
    nudges: [{ when: play('S8', 'barehanded'), text: 'BAREHANDED TAKES THE FULL 8. PICK THE SWORD (W).' }],
  },
  {
    id: 'r1FightDone',
    lesson: 'rooms',
    pages: ['THE WEAPON BLOCKED 5, SO 8 - 5 = 3 DAMAGE. THE 8 NOW SITS ON YOUR WEAPON. REMEMBER THAT.'],
    spotlight: [region('slainStack'), region('weapon'), region('hp')],
  },
  {
    id: 'r1Potion',
    lesson: 'rooms',
    pages: ['YOU ARE AT 17 HP. DRINK THE 5 OF HEARTS (KEY 4).'],
    spotlight: [card('H5'), region('hp')],
    expect: play('H5'),
    until: on('PotionUsed', 'H5'),
    nudge: 'DRINK THE 5 OF HEARTS (KEY 4).',
    nudges: [{ when: play('C3'), text: 'LEAVE THE 3. IT STAYS FOR THE NEXT ROOM.' }],
  },
  {
    id: 'r1Cleared',
    lesson: 'rooms',
    pages: [
      'HEALED 3. HP NEVER GOES ABOVE 20.',
      '3 CARDS PLAYED, SO THE ROOM IS DONE. THE 3 OF CLUBS STAYED AND 3 NEW CARDS JOINED IT.',
    ],
    spotlight: [card('C3')],
  },

  // Lesson 3/7: AVOIDING (rooms 2-3)
  {
    id: 'r2Look',
    lesson: 'avoiding',
    pages: [
      'TROUBLE. THE ACE OF SPADES HITS FOR 14, AND AT FULL HP THAT POTION WOULD HEAL NOTHING.',
      'YOUR WEAPON CANNOT TOUCH THE ACE EITHER. MORE ON THAT SOON.',
    ],
    spotlight: [card('S14'), card('H10')],
  },
  {
    id: 'r2Avoid',
    lesson: 'avoiding',
    pages: ['YOU CAN AVOID A ROOM: ALL 4 CARDS GO TO THE BOTTOM OF THE DECK. PRESS AVOID (KEY A).'],
    spotlight: [control('avoid')],
    expect: AVOID,
    until: on('RoomAvoided'),
    nudge: 'NOT THIS ROOM. PRESS AVOID (KEY A).',
  },
  {
    id: 'r3TryAvoid',
    lesson: 'avoiding',
    pages: ['A FRESH ROOM. TRY TO AVOID THIS ONE TOO (KEY A).'],
    spotlight: [control('avoid')],
    expect: AVOID,
    until: { kind: 'violation', code: 'cannotAvoidTwice' },
    nudge: 'HUMOUR ME: PRESS AVOID FIRST (KEY A).',
  },
  {
    id: 'r3Refused',
    lesson: 'avoiding',
    pages: ['REFUSED! AVOID AS OFTEN AS YOU LIKE, BUT NEVER TWO ROOMS IN A ROW. THIS ONE MUST BE FACED.'],
    spotlight: [control('avoid')],
  },

  // Lesson 4/7: WEAPONS DULL (room 3)
  {
    id: 'r3Fight6',
    lesson: 'dulling',
    pages: ['FIGHT THE 6 OF SPADES WITH YOUR WEAPON (KEY 1, THEN W).'],
    spotlight: [card('S6'), control('fightWeapon')],
    expect: play('S6', 'weapon'),
    until: on('MonsterSlain', 'S6'),
    nudge: 'THE 6 OF SPADES, WITH THE SWORD (KEY 1, THEN W).',
    nudges: [{ when: play('S6', 'barehanded'), text: 'USE THE SWORD (W). IT BLOCKS 5 OF THE 6.' }],
  },
  {
    id: 'r3Dull',
    lesson: 'dulling',
    pages: [
      'WEAPONS DULL. ONCE USED, A WEAPON ONLY FIGHTS MONSTERS NO STRONGER THAN THE LAST ONE IT KILLED.',
      'IT JUST KILLED A 6, SO ITS LIMIT IS NOW 6.',
    ],
    spotlight: [region('weaponLimit'), region('slainStack')],
  },
  {
    id: 'r3TooDull',
    lesson: 'dulling',
    pages: ['THE 9 OF CLUBS IS OVER YOUR LIMIT OF 6, SO THE WEAPON CANNOT FIGHT IT. TAKE IT BAREHANDED (KEY 2).'],
    spotlight: [card('C9'), region('weaponLimit')],
    expect: play('C9', 'barehanded'),
    until: on('MonsterSlain', 'C9'),
    nudge: 'FACE THE 9 OF CLUBS BAREHANDED (KEY 2).',
    nudges: [{ when: play('H4'), text: SAVE_POTION }],
  },
  {
    id: 'r3Fight4',
    lesson: 'dulling',
    pages: ['THE 4 OF CLUBS IS UNDER 6, SO THE WEAPON STILL WORKS. USE THE SWORD (KEY 3, THEN W).'],
    spotlight: [card('C4'), control('fightWeapon')],
    expect: play('C4', 'weapon'),
    until: on('MonsterSlain', 'C4'),
    nudge: 'THE 4 OF CLUBS, WITH THE SWORD (KEY 3, THEN W).',
    nudges: [
      { when: play('C4', 'barehanded'), text: 'NO NEED TO BLEED. THE SWORD (W) BLOCKS ALL 4.' },
      { when: play('H4'), text: SAVE_POTION },
    ],
  },

  // Lesson 5/7: POTIONS (room 4)
  {
    id: 'r4Drink',
    lesson: 'potions',
    pages: [
      'YOU ARE AT 10 HP, AND THIS ROOM HAS 2 POTIONS. ONLY ONE POTION PER ROOM HEALS.',
      'DRINK THE BIGGER ONE: THE 4 OF HEARTS (KEY 4).',
    ],
    spotlight: [card('H4'), card('H2'), region('hp')],
    expect: play('H4'),
    until: on('PotionUsed', 'H4'),
    nudge: 'DRINK THE 4 OF HEARTS (KEY 4).',
    nudges: [{ when: play('H2'), text: 'THE 4 OF HEARTS FIRST (KEY 4). BIGGER IS BETTER.' }],
  },
  {
    id: 'r4Waste',
    lesson: 'potions',
    pages: ['NOW DRINK THE 2 OF HEARTS TOO (KEY 2), AND WATCH WHAT HAPPENS.'],
    spotlight: [card('H2')],
    expect: play('H2'),
    until: on('PotionWasted', 'H2'),
    nudge: 'DRINK THE 2 OF HEARTS (KEY 2).',
  },
  {
    id: 'r4Wasted',
    lesson: 'potions',
    pages: ['WASTED! A 2ND POTION IN THE SAME ROOM DOES NOTHING. IN A REAL RUN, LEAVE SPARE POTIONS FOR LATER ROOMS.'],
    spotlight: [region('hp'), region('discard')],
  },
  {
    id: 'r4NewWeapon',
    lesson: 'potions',
    pages: ['TAKE THE 10 OF DIAMONDS (KEY 1). A NEW WEAPON REPLACES THE OLD ONE AND ITS KILLS, AND STARTS SHARP.'],
    spotlight: [card('D10'), region('weapon')],
    expect: play('D10'),
    until: on('WeaponEquipped', 'D10'),
    nudge: 'TAKE THE 10 OF DIAMONDS (KEY 1).',
    nudges: [{ when: play('C2'), text: 'LEAVE THE 2 OF CLUBS FOR LATER.' }],
  },

  // Lesson 6/7: WINNING AND LOSING (room 5)
  {
    id: 'r5Return',
    lesson: 'stakes',
    pages: ['LOOK FAMILIAR? AVOIDED CARDS COME BACK. THE ACE IS HERE, BUT NOW YOU HOLD A FRESH 10.'],
    spotlight: [card('S14'), card('C7'), card('C3')],
  },
  {
    id: 'r5Losing',
    lesson: 'stakes',
    pages: [
      'IF YOUR HP HITS 0, THE RUN IS OVER AND YOU LOSE.',
      'THEN YOUR SCORE IS NEGATIVE: MINUS THE VALUE OF EVERY MONSTER STILL IN THE DUNGEON.',
    ],
    spotlight: [region('hp'), region('score')],
  },
  {
    id: 'r5Ace',
    lesson: 'stakes',
    pages: ['BAREHANDED, THE ACE HITS FOR 14 AND YOU HAVE 14 HP. THAT IS DEATH. USE THE SWORD (KEY 1, THEN W).'],
    spotlight: [card('S14'), control('fightWeapon'), region('hp')],
    expect: play('S14', 'weapon'),
    until: on('MonsterSlain', 'S14'),
    nudge: 'BIG MONSTERS FIRST, WHILE THE BLADE IS SHARP. THE ACE (KEY 1).',
    nudges: [{ when: play('S14', 'barehanded'), text: 'THAT WOULD KILL YOU! PICK THE SWORD (W).' }],
  },
  {
    id: 'r5Seven',
    lesson: 'stakes',
    pages: ['ONLY 4 DAMAGE. YOUR LIMIT IS NOW 14. BIG ONES FIRST: THE 7 OF CLUBS, WITH THE SWORD (KEY 2, THEN W).'],
    spotlight: [card('C7'), region('weaponLimit')],
    expect: play('C7', 'weapon'),
    until: on('MonsterSlain', 'C7'),
    nudge: 'BIG ONES FIRST: THE 7 (KEY 2, THEN W). EACH KILL LOWERS THE LIMIT.',
  },
  {
    id: 'r5Three',
    lesson: 'stakes',
    pages: ['THEN THE 3 OF CLUBS (KEY 4, THEN W). LEAVE THE 2 FOR THE LAST ROOM.'],
    spotlight: [card('C3')],
    expect: play('C3', 'weapon'),
    until: on('MonsterSlain', 'C3'),
    nudge: 'THE 3 OF CLUBS, WITH THE SWORD (KEY 4, THEN W).',
    nudges: [{ when: play('C2'), text: 'KEEP THE 2 FOR LAST. TAKE THE 3 (KEY 4).' }],
  },

  // Lesson 7/7: THE FINAL ROOM (room 6)
  {
    id: 'r6Final',
    lesson: 'finalRoom',
    pages: ['THE DECK IS EMPTY, SO THIS IS THE FINAL ROOM. YOU CANNOT AVOID IT, AND EVERY CARD MUST BE PLAYED.'],
    spotlight: [region('deck'), region('room')],
  },
  {
    id: 'r6Two',
    lesson: 'finalRoom',
    pages: ['THE 2 OF CLUBS FITS UNDER YOUR LIMIT OF 3. SWORD (KEY 3, THEN W).'],
    spotlight: [card('C2'), region('weaponLimit')],
    expect: play('C2', 'weapon'),
    until: on('MonsterSlain', 'C2'),
    nudge: 'THE 2 OF CLUBS, WITH THE SWORD (KEY 3, THEN W).',
    nudges: [{ when: play('H10'), text: 'POTION LAST. TRUST ME.' }],
  },
  {
    id: 'r6Potion',
    lesson: 'finalRoom',
    pages: ['FINISH WITH THE POTION (KEY 1).'],
    spotlight: [card('H10'), region('hp')],
    expect: play('H10'),
    until: on('GameWon'),
    nudge: 'DRINK THE 10 OF HEARTS (KEY 1).',
  },
];

/** Script data is shared by every caller, so freeze it: no consumer can edit the lesson in place. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const STEPS: readonly TutorialStep[] = deepFreeze(SPECS.map(build));

/** All steps, in script order. Length and ids must match TutorialStepId exactly (Tigh tests this). */
export function tutorialSteps(): readonly TutorialStep[] {
  return STEPS;
}

const RECAP: RecapView = deepFreeze({
  title: 'DUNGEON CLEARED!',
  lines: [
    'MONSTERS HIT. WEAPONS BLOCK. POTIONS HEAL.',
    'PLAY 3 CARDS PER ROOM. THE 4TH STAYS.',
    'AVOID ANY ROOM, BUT NEVER 2 IN A ROW.',
    'A WEAPON ONLY FIGHTS UP TO ITS LAST KILL.',
    'ONE POTION HEALS PER ROOM.',
    'WIN: SCORE = HP. AT 20 HP, A LAST-CARD POTION ADDS ITS VALUE.',
    'LOSE: SCORE = MINUS THE MONSTERS LEFT.',
  ],
  score: 30,
  scoreText: '20 HP + 10 POTION BONUS',
});

/**
 * Recap screen content (docs/TUTORIAL.md "Recap"). The score is the scripted run's known result;
 * tutorialChrome() fills score and scoreText from the engine's final GameState instead, so the number shown
 * always comes from src/game.
 */
export function tutorialRecap(): RecapView {
  return RECAP;
}
