// Shared lock for one-time-offer modals. Both first-energy and floor-20
// modals must check + claim this lock so they never stack — a player can
// only pay for ONE offer at a time, ruling out the confusion where a
// stacked modal collects a payment intended for the modal underneath.

let locked = false;

export function isOneTimeOfferOpen(): boolean { return locked; }
export function lockOneTimeOffer(): boolean {
  if (locked) return false;
  locked = true;
  return true;
}
export function unlockOneTimeOffer(): void { locked = false; }
