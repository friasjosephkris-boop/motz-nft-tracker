// Battle fast-forward state. Lives in its own module so both main.ts (frame
// loop) and src/ui/battle.ts (UI buttons) can read/write it without creating
// a circular import.
//
// Rules:
//   - Only campaign mode floors 1..FAST_FORWARD_MAX_STAGE may exceed 1x.
//   - Speed resets to 1x on every fresh page load (no localStorage), so a
//     player can never get stuck at 4x after a reload.
//   - The frame loop must call isFastForwardAllowed(stageId, mode) and ignore
//     the multiplier when it returns false. The UI must also hide / disable
//     the speed buttons in that case so the state stays in sync visually.

export const FAST_FORWARD_MAX_STAGE = 20;
export type BattleSpeed = 1 | 2 | 4;

let speed: BattleSpeed = 1;

export function getBattleSpeed(): BattleSpeed { return speed; }

export function setBattleSpeed(mul: number): void {
  speed = mul === 2 || mul === 4 ? mul : 1;
}

/** Mode + stage check. The frame loop and the UI both rely on this so the
 *  rule lives in one place. */
export function isFastForwardAllowed(stageId: number, mode: string): boolean {
  return mode === "floor" && stageId >= 1 && stageId <= FAST_FORWARD_MAX_STAGE;
}
