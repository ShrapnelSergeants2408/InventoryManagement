// Mentor PIN gate (§6). Every PIN-required action calls gate(reason) first and goes ahead
// only when it resolves true. The PIN prompt that answers it is registered by the UI;
// until M6 that is a development stand-in (ui/shell/GateHost.tsx).

export type GateAsk = (reason: string) => Promise<boolean>;

let ask: GateAsk | null = null;

export function setGateAsk(fn: GateAsk | null): void {
  ask = fn;
}

/** Resolves true when the action may go ahead. With no prompt registered, nothing is allowed. */
export function gate(reason: string): Promise<boolean> {
  return ask ? ask(reason) : Promise.resolve(false);
}
