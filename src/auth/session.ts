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

export async function validateSession(token: string): Promise<{ address: string; perks: Perks } | null> {
  try {
    const r = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const data = await r.json();
    if (typeof data?.address !== "string") return null;
    const motzKey = !!data?.perks?.motzKey;
    // Wipe-epoch check: if the server's wipe counter has advanced since the
    // last time this browser saw it, every cached value (XP, stage unlocks,
    // inventory, …) is stale by definition. Preserve the session token,
    // nuke everything else, reload. Without this, players whose tabs were
    // open during a wipe keep seeing pre-wipe data until they manually
    // clear browser storage — which is exactly what's been happening.
    if (typeof data?.wipeEpoch === "number") {
      maybeApplyWipeEpoch(data.wipeEpoch);
    }
    return { address: data.address, perks: { motzKey } };
  } catch {
    return null;
  }
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
