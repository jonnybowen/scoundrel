/**
 * Public surface of the tutorial module (Design Review 2). Other modules import from './tutorial' only.
 * Pure and DOM-free: compiled by tsconfig.game.json alongside src/game. Imports only from src/game (the index, plus game/notImplemented for stubs).
 * NOT wired into the running app until Starbuck lands ui/tutorialController.ts.
 */
export * from './types';
export * from './machine';
export * from './script';
