import { Grid } from '../model/grid';
import { LayerManager } from '../layers/layers';
import { Propagator, Contradiction } from '../propagation/propagator';
import { VisualHooks } from '../visual/visual-hooks';
import { SolverState, StateStack } from '../model/state-stack';

// --- BigInt helpers ---
function bitLength(n: bigint): number {
  if (n === 0n) return 0;
  let len = 0; let v = n;
  while (v) { v >>= 1n; len++; }
  return len;
}

function popcount(n: bigint): number {
  let count = 0; let v = n;
  while (v) { v &= v - 1n; count++; }
  return count;
}

function maskToList(mask: bigint): number[] {
  const res: number[] = [];
  let curr = mask;
  while (curr) {
    const bit = curr & (-curr);
    res.push(bitLength(bit));
    curr &= ~bit;
  }
  return res;
}

export class SearchRestart extends Error {
  constructor(msg: string) { super(msg); this.name = 'SearchRestart'; }
}

/**
 * Branching engine with MRV + LCV + stagnation detection.
 */
export class BranchingEngine {
  grid: Grid;
  layers: LayerManager;
  propagator: Propagator;
  private visual: VisualHooks;
  private stateStack: StateStack;

  nodesVisited = 0;
  private restartThreshold: number;
  tryCounts: Map<string, number> = new Map();
  unitTryCounts: Map<string, number> = new Map();
  hotPairCount = 0;
  private decayFactor = 0.5;

  stopRequested: () => boolean = () => false;

  private lastAllMasks: bigint[] = [];

  constructor(grid: Grid, layers: LayerManager, propagator: Propagator, visual: VisualHooks) {
    this.grid = grid;
    this.layers = layers;
    this.propagator = propagator;
    this.visual = visual;
    this.stateStack = new StateStack();
    const N = grid.size;
    this.restartThreshold = Math.max(N * 1000, N * N * 200);
  }

  private selectBestCell(): { r: number; c: number; mask: bigint } | null {
    const N = this.grid.size;
    let minCount = N + 1;
    let mrvCells: { r: number; c: number; mask: bigint }[] = [];

    const allMasks = this.layers.getAllAllowedMasks();
    this.lastAllMasks = allMasks;

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.grid.get(r, c) !== 0) continue;
        const mask = allMasks[r * N + c];
        const count = popcount(mask);
        if (count === 0) throw new Contradiction(`Cell (${r},${c}) has no candidates`);
        if (count < minCount) { minCount = count; mrvCells = [{ r, c, mask }]; }
        else if (count === minCount) { mrvCells.push({ r, c, mask }); }
      }
    }

    this.nodesVisited++;
    if (this.nodesVisited > this.restartThreshold) {
      throw new SearchRestart('Restarting search to explore new paths...');
    }

    if (!mrvCells.length) return null;

    let bestCell: { r: number; c: number; mask: bigint } | null = null;
    let maxPriority = -1;
    const bs = this.grid.boxSize;

    for (const cell of mrvCells) {
      const deg = this.layers.getCellDegree(cell.r, cell.c);
      const digits = maskToList(cell.mask);
      let heat = 0;
      for (const d of digits) heat += this.tryCounts.get(`${cell.r},${cell.c},${d}`) ?? 0;
      const boxId = Math.floor(cell.r / bs) * bs + Math.floor(cell.c / bs);
      let unitHeat = 0;
      for (const d of digits) {
        unitHeat += this.unitTryCounts.get(`0,${cell.r},${d}`) ?? 0;
        unitHeat += this.unitTryCounts.get(`1,${cell.c},${d}`) ?? 0;
        unitHeat += this.unitTryCounts.get(`2,${boxId},${d}`) ?? 0;
      }
      const priority = deg * 1000 + heat * 200 + unitHeat * 100;
      if (priority > maxPriority) { maxPriority = priority; bestCell = cell; }
    }
    return bestCell;
  }

  private checkStagnation(r: number, c: number, d: number): void {
    const key = `${r},${c},${d}`;
    const old = this.tryCounts.get(key) ?? 0;
    const next = old + 1;
    this.tryCounts.set(key, next);
    const N = this.grid.size;
    if (next > Math.max(15, N * 2)) {
      throw new SearchRestart(`Stagnation at (${r}, ${c}) for digit ${d}`);
    }
    if (old <= 5 && next > 5) this.hotPairCount++;
    if (this.hotPairCount > Math.max(40, Math.floor(N * N / 10))) {
      throw new SearchRestart('Global search stagnation detected.');
    }
  }

  private recordUnitFailure(r: number, c: number, d: number): void {
    const boxId = Math.floor(r / this.grid.boxSize) * this.grid.boxSize + Math.floor(c / this.grid.boxSize);
    const k0 = `0,${r},${d}`, k1 = `1,${c},${d}`, k2 = `2,${boxId},${d}`;
    this.unitTryCounts.set(k0, (this.unitTryCounts.get(k0) ?? 0) + 1);
    this.unitTryCounts.set(k1, (this.unitTryCounts.get(k1) ?? 0) + 1);
    this.unitTryCounts.set(k2, (this.unitTryCounts.get(k2) ?? 0) + 1);
  }

  private saveState(): void {
    this.stateStack.push(this.layers.saveState());
  }

  private restoreState(): void {
    const state = this.stateStack.pop();
    this.layers.restoreState(state);
  }

  private orderDigitsLcv(r: number, c: number, digits: number[], allMasks: bigint[]): number[] {
    const N = this.grid.size;
    const bs = this.grid.boxSize;
    const br = Math.floor(r / bs) * bs;
    const bc = Math.floor(c / bs) * bs;
    const boxId = Math.floor(r / bs) * bs + Math.floor(c / bs);
    const scored: [number, number, number][] = [];

    for (const d of digits) {
      const bit = 1n << BigInt(d - 1);
      let eliminations = 0;
      for (let i = 0; i < N; i++) {
        if (i !== c && (allMasks[r * N + i] & bit)) eliminations++;
        if (i !== r && (allMasks[i * N + c] & bit)) eliminations++;
      }
      for (let dr = 0; dr < bs; dr++) {
        for (let dc = 0; dc < bs; dc++) {
          const rr = br + dr, cc = bc + dc;
          if ((rr !== r || cc !== c) && rr !== r && cc !== c && (allMasks[rr * N + cc] & bit)) {
            eliminations++;
          }
        }
      }
      const unitFail =
        (this.unitTryCounts.get(`0,${r},${d}`) ?? 0) +
        (this.unitTryCounts.get(`1,${c},${d}`) ?? 0) +
        (this.unitTryCounts.get(`2,${boxId},${d}`) ?? 0);
      scored.push([unitFail, eliminations, d]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.map(([, , d]) => d);
  }

  solveWithBranching(): boolean {
    let bestCell: { r: number; c: number; mask: bigint } | null;
    try {
      bestCell = this.selectBestCell();
    } catch (e) {
      if (e instanceof Contradiction) return false;
      throw e;
    }
    if (!bestCell) return this.isSolved();

    let allowed = maskToList(bestCell.mask);
    allowed = this.orderDigitsLcv(bestCell.r, bestCell.c, allowed, this.lastAllMasks);
    this.visual.markCellFallback(bestCell.r, bestCell.c, allowed);

    interface Frame { r: number; c: number; digits: number[]; idx: number }
    const stack: Frame[] = [{ r: bestCell.r, c: bestCell.c, digits: allowed, idx: 0 }];

    while (stack.length) {
      if (this.stopRequested()) return false;

      const current = stack[stack.length - 1];
      const { r, c, digits } = current;

      if (current.idx < digits.length) {
        const d = digits[current.idx];
        current.idx++;

        this.checkStagnation(r, c, d);
        this.saveState();
        this.grid.set(r, c, d);
        this.layers.updateMasks(r, c, d, true);

        try {
          this.propagator.runPropagation(this.stopRequested);
          const bestNext = this.selectBestCell();
          if (!bestNext) return true; // solved

          let allowedNext = maskToList(bestNext.mask);
          allowedNext = this.orderDigitsLcv(bestNext.r, bestNext.c, allowedNext, this.lastAllMasks);
          stack.push({ r: bestNext.r, c: bestNext.c, digits: allowedNext, idx: 0 });
        } catch (e) {
          if (e instanceof Contradiction) {
            this.restoreState();
            this.recordUnitFailure(r, c, d);
          } else {
            throw e;
          }
        }
      } else {
        stack.pop();
        if (stack.length) {
          this.restoreState();
          const last = stack[stack.length - 1];
          const lastD = last.digits[last.idx - 1];
          this.recordUnitFailure(last.r, last.c, lastD);
        }
      }
    }
    return false;
  }

  decayCounts(): void {
    let hot = 0;
    for (const [key, val] of this.tryCounts) {
      const decayed = val * this.decayFactor;
      if (decayed < 0.1) this.tryCounts.delete(key);
      else { this.tryCounts.set(key, decayed); if (decayed > 5) hot++; }
    }
    this.hotPairCount = hot;
    for (const [key, val] of this.unitTryCounts) {
      const decayed = val * this.decayFactor;
      if (decayed < 0.1) this.unitTryCounts.delete(key);
      else this.unitTryCounts.set(key, decayed);
    }
  }

  isSolved(): boolean {
    const vals = this.grid.values;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] === 0) return false;
    }
    return true;
  }
}
