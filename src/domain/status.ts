// Stock highlighting (SPEC §4) and its labels (§17: color + icon + word).

export type StockStatus =
  | { kind: 'short'; short: number }
  | { kind: 'low' }
  | { kind: 'ok' };

/**
 * Red ("short"): on_hand < desired.
 * Yellow ("low spares"): desired ≤ on_hand < desired + spares.
 * No highlight ("ok"): on_hand ≥ desired + spares.
 */
export function stockStatus(onHand: number, desired: number, spares: number): StockStatus {
  if (onHand < desired) return { kind: 'short', short: desired - onHand };
  if (onHand < desired + spares) return { kind: 'low' };
  return { kind: 'ok' };
}

/** The word shown with the status icon: "SHORT n", "LOW SPARES" or "OK". */
export function statusLabel(s: StockStatus): string {
  switch (s.kind) {
    case 'short':
      return `SHORT ${s.short}`;
    case 'low':
      return 'LOW SPARES';
    case 'ok':
      return 'OK';
  }
}
