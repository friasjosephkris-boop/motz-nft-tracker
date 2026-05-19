// Persistent record of highest stage cleared. Used to gate stage-select unlocks.

import { scopedKey } from "../auth/scope";
const KEY = () => scopedKey("tower-of-zeal.clears.v1");

export function getMaxCleared(): number {
  try {
    const raw = localStorage.getItem(KEY());
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  } catch { return 0; }
}

export function recordClear(stageId: number): void {
  const cur = getMaxCleared();
  if (stageId <= cur) return;
  try { localStorage.setItem(KEY(), String(stageId)); } catch { /* ignore */ }
}

/** Overwrite local max-cleared with the server-canonical value. Called from
 *  pullCanonicalProgress so a server wipe is reflected in the client's stage
 *  unlocks — otherwise localStorage keeps every stage unlocked after a wipe. */
export function setMaxClearedFromServer(serverMax: number): void {
  const clamped = Math.max(0, Math.floor(Number.isFinite(serverMax) ? serverMax : 0));
  try { localStorage.setItem(KEY(), String(clamped)); } catch { /* ignore */ }
}
