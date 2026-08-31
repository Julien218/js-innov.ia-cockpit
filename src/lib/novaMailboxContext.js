// Only the currently mounted mailbox page supplies this ephemeral context.
let current = null;
export function setNovaMailboxContext(value) { current = value; }
export function getNovaMailboxContext() { return current; }
