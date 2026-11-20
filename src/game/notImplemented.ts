/** Placeholder thrower for contract stubs. Owners replace call sites with real implementations. */
export function notImplemented(what: string, owner: string): never {
  throw new Error(`not implemented: ${what} (owner: ${owner})`);
}
