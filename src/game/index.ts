/**
 * Public surface of the rules engine. Other modules import from './game' (this file) only.
 * src/game must never import from render/, fx/, audio/ or ui/ and must not touch DOM APIs
 * (enforced by tsconfig.game.json, which compiles src/game without the DOM lib).
 */
export * from './cards';
export * from './rng';
export * from './state';
export * from './actions';
export * from './events';
export * from './engine';
export * from './session';
