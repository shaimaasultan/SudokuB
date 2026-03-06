/**
 * LIFO state stack for backtracking. Stores deep copies of solver state.
 */
export type MaskArray = BigUint64Array | bigint[];

export interface SolverState {
  gridValues: Int32Array;
  rowMasks: MaskArray;
  colMasks: MaskArray;
  boxMasks: MaskArray;
  manualMasks: MaskArray;
}

function cloneMasks(arr: MaskArray): MaskArray {
  return arr instanceof BigUint64Array ? arr.slice() : (arr as bigint[]).slice();
}

export class StateStack {
  private stack: SolverState[] = [];

  push(state: SolverState): void {
    this.stack.push({
      gridValues: state.gridValues.slice(),
      rowMasks: cloneMasks(state.rowMasks),
      colMasks: cloneMasks(state.colMasks),
      boxMasks: cloneMasks(state.boxMasks),
      manualMasks: cloneMasks(state.manualMasks),
    });
  }

  pop(): SolverState {
    const s = this.stack.pop();
    if (!s) throw new Error('State stack underflow.');
    return s;
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}
