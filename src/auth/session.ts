const STORAGE_KEY = "toz.session";

export interface Session {
  token: string;
  address: string;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== "string" || typeof parsed?.address !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export interface Perks { motzKey: boolean }

/** Result of a session check. The three states must stay distinct:
 *   - "valid"       → server confirmed the session.
 *   - "invalid"     → server DEFINITIVELY rejected it (bad/expired JWT, or the
 *                     wallet verifiably no longer holds the gated NFT). Only
 *                     this state should ever revoke the session.
 *   - "unreachable" → couldn't get a definitive answer (offline, timeout,
 *                     5xx). Ambiguous — the session may well still be good,
 *                     so callers must NOT clear it; just retry later. */
export type SessionCheck =
  | { status: "valid"; address: string; perks: Perks }
  | { status: "invalid" }
  | { status: "unreachable" };

export async function validateSession(token: string): Promise<SessionCheck> {
  let r: Response;
  try {
    r = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Network error — never reached the server. Ambiguous, not a rejection.
    return { status: "unreachable" };
  }
  // 401/403 are the ONLY definitive rejections: a bad/expired JWT, or the
  // wallet verifiably no longer holds the gated NFT. Any other non-OK status
  // (500/502/503/504, a cold-start timeout, a gateway error) is a server-side
  // hiccup — treat it as unreachable so a transient blip can't kick an
  // authenticated player back to the wallet gate.
  if (r.status === 401 || r.status === 403) return { status: "invalid" };
  if (!r.ok) return { status: "unreachable" };
  let data: unknown;
  try {
    data = await r.json();
  } catch {
    return { status: "unreachable" };
  }
  const d = data as { address?: unknown; perks?: { motzKey?: unknown }; wipeEpoch?: unknown; forceResetAt?: unknown };
  if (typeof d?.address !== "string") return { status: "unreachable" };
  const motzKey = !!d?.perks?.motzKey;
  // Wipe-epoch check: if the server's wipe counter has advanced since the
  // last time this browser saw it, every cached value (XP, stage unlocks,
  // inventory, …) is stale by definition. Preserve the session token,
  // nuke everything else, reload. Without this, players whose tabs were
  // open during a wipe keep seeing pre-wipe data until they manually
  // clear browser storage — which is exactly what's been happening.
  if (typeof d?.wipeEpoch === "number") {
    maybeApplyWipeEpoch(d.wipeEpoch);
  }
  if (typeof d?.forceResetAt === "number") {
    maybeApplyForceReset(d.forceResetAt);
  }
  return { status: "valid", address: d.address, perks: { motzKey } };
}

const FORCE_RESET_KEY = "tower-of-zeal.force-reset-at.v1";
function maybeApplyForceReset(serverStamp: number): void {
  if (!serverStamp) return;
  let local = 0;
  try { local = Number(localStorage.getItem(FORCE_RESET_KEY) ?? "0") || 0; } catch { /* ignore */ }
  if (serverStamp <= local) return;
  // First time seeing a non-zero stamp on this client. Two cases:
  //   - admin set it for THIS wallet on purpose → we should nuke
  //   - this is just a stale stamp from before this client existed → nuke is fine,
  //     localStorage is empty or first-boot anyway
  // No harm either way, so always honor the advance (unlike the global epoch).
  const sessionBackup = localStorage.getItem(STORAGE_KEY);
  try { localStorage.clear(); } catch { /* ignore */ }
  if (sessionBackup) {
    try { localStorage.setItem(STORAGE_KEY, sessionBackup); } catch { /* ignore */ }
  }
  try { localStorage.setItem(FORCE_RESET_KEY, String(serverStamp)); } catch { /* ignore */ }
  window.location.reload();
}

const WIPE_EPOCH_KEY = "tower-of-zeal.wipe-epoch.v1";
function maybeApplyWipeEpoch(serverEpoch: number): void {
  let local = 0;
  try { local = Number(localStorage.getItem(WIPE_EPOCH_KEY) ?? "0") || 0; } catch { /* ignore */ }
  if (serverEpoch <= local) return;
  // First time this browser ever saw the field: just record it, don't nuke
  // (would clobber fresh first-time players). Only react when we have a
  // baseline AND the server moved past it.
  if (local === 0) {
    try { localStorage.setItem(WIPE_EPOCH_KEY, String(serverEpoch)); } catch { /* ignore */ }
    return;
  }
  const sessionBackup = localStorage.getItem(STORAGE_KEY);
  try { localStorage.clear(); } catch { /* ignore */ }
  if (sessionBackup) {
    try { localStorage.setItem(STORAGE_KEY, sessionBackup); } catch { /* ignore */ }
  }
  try { localStorage.setItem(WIPE_EPOCH_KEY, String(serverEpoch)); } catch { /* ignore */ }
  window.location.reload();
}

// Module-level cache of the wallet address the server actually verified for
// this session. localStorage settings/session contents are user-editable, so
// anything that needs to TRUST an address (admin gating, leaderboard binding)
// must read from here rather than from settings.walletAddress.
let verifiedAddress: string | null = null;
let verifiedPerks: Perks = { motzKey: false };

export function setVerifiedAddress(addr: string): void {
  verifiedAddress = addr.trim().toLowerCase();
}

export function getVerifiedAddress(): string | null {
  return verifiedAddress;
}

export function clearVerifiedAddress(): void {
  verifiedAddress = null;
  verifiedPerks = { motzKey: false };
}

export function setVerifiedPerks(p: Perks): void {
  verifiedPerks = { motzKey: !!p.motzKey };
}

export function getVerifiedPerks(): Perks {
  return verifiedPerks;
}
