// Mentor PIN gate (§6). Every PIN-required action calls gate(reason) first and goes ahead
// only when it resolves true: at once while unlocked, otherwise after the PIN pad
// (ui/shell/GateHost.tsx) has unlocked mentor tools.
import { isUnlocked } from './lock';

export type GateAsk = (reason: string) => Promise<boolean>;

let ask: GateAsk | null = null;

export function setGateAsk(fn: GateAsk | null): void {
  ask = fn;
}

/** Resolves true when the action may go ahead. With no PIN pad registered, nothing is allowed. */
export function gate(reason: string): Promise<boolean> {
  if (isUnlocked()) return Promise.resolve(true);
  return ask ? ask(reason) : Promise.resolve(false);
}
