/**
 * LIFO state stack for backtracking. Stores deep copies of solver state.
 */
export interface SolverState {
  gridValues: Int32Array;
  rowMasks: BigUint64Array;
  colMasks: BigUint64Array;
  boxMasks: BigUint64Array;
  manualMasks: BigUint64Array;
}

export class StateStack {
  private stack: SolverState[] = [];

  push(state: SolverState): void {
    this.stack.push({
      gridValues: state.gridValues.slice(),
      rowMasks: state.rowMasks.slice(),
      colMasks: state.colMasks.slice(),
      boxMasks: state.boxMasks.slice(),
      manualMasks: state.manualMasks.slice(),
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
