/**
 * Visualization hook interface. Default is no-op.
 * Implement for GUI/web feedback.
 */
export interface VisualHooks {
  markForced(r: number, c: number, d: number): void;
  markGuess(r: number, c: number, d: number): void;
  markContradictionCell(r: number, c: number): void;
  markCellFallback(r: number, c: number, allowed: number[]): void;
  startBatch(): void;
  endBatch(): void;
}

export const NO_OP_VISUAL: VisualHooks = {
  markForced() {},
  markGuess() {},
  markContradictionCell() {},
  markCellFallback() {},
  startBatch() {},
  endBatch() {},
};
