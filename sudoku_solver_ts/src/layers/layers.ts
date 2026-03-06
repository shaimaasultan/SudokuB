import { Grid } from '../model/grid';

/**
 * Bitmask-based candidate tracking using BigInt for sizes up to 64×64.
 * Each row/col/box has a bitmask of placed digits.
 * Allowed = fullMask & ~(row | col | box | manual)
 */
export class LayerManager {
  readonly grid: Grid;
  readonly size: number;
  readonly fullMask: bigint;

  rowMasks: BigUint64Array;
  colMasks: BigUint64Array;
  boxMasks: BigUint64Array;
  manualMasks: BigUint64Array; // per cell: size*size

  private boxIdx: Int32Array; // precomputed box index for each cell

  constructor(grid: Grid, skipRebuild = false) {
    this.grid = grid;
    this.size = grid.size;
    this.fullMask = (1n << BigInt(this.size)) - 1n;

    this.rowMasks = new BigUint64Array(this.size);
    this.colMasks = new BigUint64Array(this.size);
    this.boxMasks = new BigUint64Array(this.size);
    this.manualMasks = new BigUint64Array(this.size * this.size);

    // Precompute box index
    const N = this.size;
    const bs = grid.boxSize;
    this.boxIdx = new Int32Array(N * N);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        this.boxIdx[r * N + c] = Math.floor(r / bs) * Math.floor(N / bs) + Math.floor(c / bs);
      }
    }

    if (!skipRebuild) {
      this.rebuildAllLayers();
    }
  }

  clone(grid?: Grid): LayerManager {
    const g = grid ?? this.grid.clone();
    const lm = new LayerManager(g, true);
    lm.rowMasks.set(this.rowMasks);
    lm.colMasks.set(this.colMasks);
    lm.boxMasks.set(this.boxMasks);
    lm.manualMasks.set(this.manualMasks);
    return lm;
  }

  rebuildAllLayers(): void {
    this.rowMasks.fill(0n);
    this.colMasks.fill(0n);
    this.boxMasks.fill(0n);
    this.manualMasks.fill(0n);

    const N = this.size;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = this.grid.get(r, c);
        if (v !== 0) {
          const bit = 1n << BigInt(v - 1);
          const b = this.boxIdx[r * N + c];
          this.rowMasks[r] |= bit;
          this.colMasks[c] |= bit;
          this.boxMasks[b] |= bit;
        }
      }
    }
  }

  updateMasks(r: number, c: number, v: number, setBits: boolean): void {
    const bit = 1n << BigInt(v - 1);
    const b = this.boxIdx[r * this.size + c];
    if (setBits) {
      this.rowMasks[r] |= bit;
      this.colMasks[c] |= bit;
      this.boxMasks[b] |= bit;
    } else {
      this.rowMasks[r] &= ~bit;
      this.colMasks[c] &= ~bit;
      this.boxMasks[b] &= ~bit;
    }
  }

  getBoxIndex(r: number, c: number): number {
    return this.boxIdx[r * this.size + c];
  }

  getAllowedMask(r: number, c: number): bigint {
    if (!this.grid.isEmpty(r, c)) return 0n;
    const idx = r * this.size + c;
    const b = this.boxIdx[idx];
    const forbidden = this.rowMasks[r] | this.colMasks[c] | this.boxMasks[b] | this.manualMasks[idx];
    return this.fullMask & ~forbidden;
  }

  /**
   * Returns array of allowed masks for all cells. Index = r*N+c.
   */
  getAllAllowedMasks(): bigint[] {
    const N = this.size;
    const result = new Array<bigint>(N * N);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const idx = r * N + c;
        if (this.grid.values[idx] !== 0) {
          result[idx] = 0n;
        } else {
          const b = this.boxIdx[idx];
          const forbidden = this.rowMasks[r] | this.colMasks[c] | this.boxMasks[b] | this.manualMasks[idx];
          result[idx] = this.fullMask & ~forbidden;
        }
      }
    }
    return result;
  }

  isDigitPossibleAt(d: number, r: number, c: number): boolean {
    if (!this.grid.isEmpty(r, c)) return false;
    const bit = 1n << BigInt(d - 1);
    const idx = r * this.size + c;
    const b = this.boxIdx[idx];
    return !((this.rowMasks[r] | this.colMasks[c] | this.boxMasks[b] | this.manualMasks[idx]) & bit);
  }

  forbidChoice(d: number, r: number, c: number): void {
    this.manualMasks[r * this.size + c] |= (1n << BigInt(d - 1));
  }

  getCellDegree(r: number, c: number): number {
    let count = 0;
    const N = this.size;
    const bs = this.grid.boxSize;
    for (let i = 0; i < N; i++) {
      if (i !== c && this.grid.isEmpty(r, i)) count++;
      if (i !== r && this.grid.isEmpty(i, c)) count++;
    }
    const br = Math.floor(r / bs) * bs;
    const bc = Math.floor(c / bs) * bs;
    for (let dr = 0; dr < bs; dr++) {
      for (let dc = 0; dc < bs; dc++) {
        const rr = br + dr, cc = bc + dc;
        if (rr !== r && cc !== c && this.grid.isEmpty(rr, cc)) count++;
      }
    }
    return count;
  }

  /**
   * Save and restore helpers for state stack integration.
   */
  saveState(): {
    gridValues: Int32Array;
    rowMasks: BigUint64Array;
    colMasks: BigUint64Array;
    boxMasks: BigUint64Array;
    manualMasks: BigUint64Array;
  } {
    return {
      gridValues: this.grid.values.slice(),
      rowMasks: this.rowMasks.slice(),
      colMasks: this.colMasks.slice(),
      boxMasks: this.boxMasks.slice(),
      manualMasks: this.manualMasks.slice(),
    };
  }

  restoreState(state: {
    gridValues: Int32Array;
    rowMasks: BigUint64Array;
    colMasks: BigUint64Array;
    boxMasks: BigUint64Array;
    manualMasks: BigUint64Array;
  }): void {
    this.grid.values.set(state.gridValues);
    this.rowMasks.set(state.rowMasks);
    this.colMasks.set(state.colMasks);
    this.boxMasks.set(state.boxMasks);
    this.manualMasks.set(state.manualMasks);
  }
}
