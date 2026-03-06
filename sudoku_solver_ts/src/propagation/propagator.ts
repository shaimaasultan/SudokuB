import { Grid } from '../model/grid';
import { LayerManager } from '../layers/layers';
import { VisualHooks } from '../visual/visual-hooks';

// --- Helpers for BigInt bit manipulation ---
function popcount(n: bigint): number {
  let count = 0;
  let v = n;
  while (v) { v &= v - 1n; count++; }
  return count;
}

function bitLength(n: bigint): number {
  if (n === 0n) return 0;
  let len = 0;
  let v = n;
  while (v) { v >>= 1n; len++; }
  return len;
}

function lowestBit(n: bigint): bigint {
  return n & (-n);
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

// --- Exceptions ---
export class Contradiction extends Error {
  constructor(msg: string) { super(msg); this.name = 'Contradiction'; }
}

interface ForcedMove {
  row: number;
  col: number;
  digit: number;
}

/**
 * Constraint propagation engine.
 * Applies techniques in order: full house, naked/hidden singles,
 * pointing pairs, naked pairs/triples, hidden pairs, simple coloring.
 */
export class Propagator {
  grid: Grid;
  layers: LayerManager;
  private visual: VisualHooks;

  constructor(grid: Grid, layers: LayerManager, visual: VisualHooks) {
    this.grid = grid;
    this.layers = layers;
    this.visual = visual;
  }

  runPropagation(stopRequested: () => boolean): void {
    this.visual.startBatch();
    try {
      while (true) {
        if (stopRequested()) return;

        if (this.applyFullHouseSignal()) {
          this.checkForContradictions();
          continue;
        }

        const forced = this.findForcedMoves();
        if (forced.length) {
          this.applyForcedMoves(forced);
          this.checkForContradictions();
          continue;
        }

        if (
          this.applyPointingPairs() ||
          this.applyNakedPairs() ||
          this.applyNakedTriples() ||
          this.applyHiddenPairs() ||
          this.applySimpleColoring()
        ) {
          this.checkForContradictions();
          continue;
        }

        this.checkForContradictions();
        return;
      }
    } finally {
      this.visual.endBatch();
    }
  }

  // ----------------------------------------------------------------
  // Full House: unit with exactly 1 empty cell
  // ----------------------------------------------------------------
  private applyFullHouseSignal(): boolean {
    const N = this.size;
    const fullMask = this.layers.fullMask;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);
    const moves: [number, number, number][] = [];

    // Count empties per row/col/box
    const rowCnt = new Int32Array(N);
    const colCnt = new Int32Array(N);
    const boxCnt = new Int32Array(N);
    const rowEmpty = new Int32Array(N); // last empty col in row
    const colEmpty = new Int32Array(N); // last empty row in col
    const boxEmptyR = new Int32Array(N);
    const boxEmptyC = new Int32Array(N);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.grid.isEmpty(r, c)) {
          rowCnt[r]++;
          rowEmpty[r] = c;
          colCnt[c]++;
          colEmpty[c] = r;
          const b = this.layers.getBoxIndex(r, c);
          boxCnt[b]++;
          boxEmptyR[b] = r;
          boxEmptyC[b] = c;
        }
      }
    }

    for (let i = 0; i < N; i++) {
      if (rowCnt[i] === 1) {
        const unocc = fullMask & ~this.layers.rowMasks[i];
        if (unocc && (unocc & (unocc - 1n)) === 0n) {
          moves.push([i, rowEmpty[i], bitLength(unocc)]);
        }
      }
      if (colCnt[i] === 1) {
        const unocc = fullMask & ~this.layers.colMasks[i];
        if (unocc && (unocc & (unocc - 1n)) === 0n) {
          moves.push([colEmpty[i], i, bitLength(unocc)]);
        }
      }
      if (boxCnt[i] === 1) {
        const unocc = fullMask & ~this.layers.boxMasks[i];
        if (unocc && (unocc & (unocc - 1n)) === 0n) {
          moves.push([boxEmptyR[i], boxEmptyC[i], bitLength(unocc)]);
        }
      }
    }

    if (!moves.length) return false;
    let applied = false;
    for (const [r, c, d] of moves) {
      if (this.grid.isEmpty(r, c)) {
        this.grid.set(r, c, d);
        this.layers.updateMasks(r, c, d, true);
        this.visual.markForced(r, c, d);
        applied = true;
      }
    }
    return applied;
  }

  // ----------------------------------------------------------------
  // Naked singles + Hidden singles
  // ----------------------------------------------------------------
  private findForcedMoves(): ForcedMove[] {
    const N = this.size;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);
    const naked: ForcedMove[] = [];

    const rowOnce = new Array<bigint>(N).fill(0n);
    const rowMultiple = new Array<bigint>(N).fill(0n);
    const rowCell: Map<number, number>[] = Array.from({ length: N }, () => new Map());
    const colOnce = new Array<bigint>(N).fill(0n);
    const colMultiple = new Array<bigint>(N).fill(0n);
    const colCell: Map<number, number>[] = Array.from({ length: N }, () => new Map());
    const boxOnce = new Array<bigint>(N).fill(0n);
    const boxMultiple = new Array<bigint>(N).fill(0n);
    const boxCell: Map<number, [number, number]>[] = Array.from({ length: N }, () => new Map());

    const allMasks = this.layers.getAllAllowedMasks();

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const mask = allMasks[r * N + c];
        if (!mask) continue;
        // Naked single
        if ((mask & (mask - 1n)) === 0n) {
          naked.push({ row: r, col: c, digit: bitLength(mask) });
        }
        // Hidden singles accumulation
        const b = this.layers.getBoxIndex(r, c);
        let curr = mask;
        while (curr) {
          const bit = curr & (-curr);
          const d = bitLength(bit);
          if (rowOnce[r] & bit) { rowMultiple[r] |= bit; }
          else { rowOnce[r] |= bit; rowCell[r].set(d, c); }
          if (colOnce[c] & bit) { colMultiple[c] |= bit; }
          else { colOnce[c] |= bit; colCell[c].set(d, r); }
          if (boxOnce[b] & bit) { boxMultiple[b] |= bit; }
          else { boxOnce[b] |= bit; boxCell[b].set(d, [r, c] as [number, number]); }
          curr &= ~bit;
        }
      }
    }

    if (naked.length) return this.deduplicate(naked);

    const forced: ForcedMove[] = [];
    for (let i = 0; i < N; i++) {
      let singles = rowOnce[i] & ~rowMultiple[i];
      while (singles) {
        const bit = singles & (-singles);
        const d = bitLength(bit);
        forced.push({ row: i, col: rowCell[i].get(d)!, digit: d });
        singles &= ~bit;
      }
      singles = colOnce[i] & ~colMultiple[i];
      while (singles) {
        const bit = singles & (-singles);
        const d = bitLength(bit);
        forced.push({ row: colCell[i].get(d)!, col: i, digit: d });
        singles &= ~bit;
      }
      singles = boxOnce[i] & ~boxMultiple[i];
      while (singles) {
        const bit = singles & (-singles);
        const d = bitLength(bit);
        const [rr, cc] = boxCell[i].get(d)!;
        forced.push({ row: rr, col: cc, digit: d });
        singles &= ~bit;
      }
    }
    return this.deduplicate(forced);
  }

  private deduplicate(moves: ForcedMove[]): ForcedMove[] {
    const map = new Map<string, ForcedMove>();
    for (const mv of moves) {
      map.set(`${mv.row},${mv.col}`, mv);
    }
    return Array.from(map.values());
  }

  private applyForcedMoves(moves: ForcedMove[]): void {
    for (const mv of moves) {
      if (this.grid.isEmpty(mv.row, mv.col)) {
        this.grid.set(mv.row, mv.col, mv.digit);
        this.layers.updateMasks(mv.row, mv.col, mv.digit, true);
        this.visual.markForced(mv.row, mv.col, mv.digit);
      }
    }
  }

  // ----------------------------------------------------------------
  // Pointing Pairs
  // ----------------------------------------------------------------
  private applyPointingPairs(): boolean {
    const N = this.size;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);
    let anyPruned = false;

    // box_d_cells[box][digit] = array of [r, c]
    const boxDCells: [number, number][][][] = Array.from({ length: N },
      () => Array.from({ length: N + 1 }, () => []));

    const allMasks = this.layers.getAllAllowedMasks();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const mask = allMasks[r * N + c];
        if (!mask) continue;
        const b = this.layers.getBoxIndex(r, c);
        let curr = mask;
        while (curr) {
          const bit = curr & (-curr);
          boxDCells[b][bitLength(bit)].push([r, c]);
          curr &= ~bit;
        }
      }
    }

    for (let bi = 0; bi < N; bi++) {
      const br = Math.floor(bi / bsCols) * bs;
      const bc = (bi % bsCols) * bs;
      for (let d = 1; d <= N; d++) {
        const candidates = boxDCells[bi][d];
        if (!candidates.length) continue;

        // Row alignment
        const firstR = candidates[0][0];
        if (candidates.every(([r]) => r === firstR)) {
          for (let col = 0; col < N; col++) {
            if (col >= bc && col < bc + bs) continue;
            if (this.layers.isDigitPossibleAt(d, firstR, col)) {
              this.layers.forbidChoice(d, firstR, col);
              anyPruned = true;
            }
          }
        }

        // Col alignment
        const firstC = candidates[0][1];
        if (candidates.every(([, c]) => c === firstC)) {
          for (let row = 0; row < N; row++) {
            if (row >= br && row < br + bs) continue;
            if (this.layers.isDigitPossibleAt(d, row, firstC)) {
              this.layers.forbidChoice(d, row, firstC);
              anyPruned = true;
            }
          }
        }
      }
    }
    return anyPruned;
  }

  // ----------------------------------------------------------------
  // Collect unit cells (shared by naked pairs/triples)
  // ----------------------------------------------------------------
  private collectUnitCells() {
    const N = this.size;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);
    const rowCells: { mask: bigint; r: number; c: number }[][] = Array.from({ length: N }, () => []);
    const colCells: { mask: bigint; r: number; c: number }[][] = Array.from({ length: N }, () => []);
    const boxCells: { mask: bigint; r: number; c: number }[][] = Array.from({ length: N }, () => []);
    const allMasks = this.layers.getAllAllowedMasks();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const mask = allMasks[r * N + c];
        if (!mask) continue;
        const b = this.layers.getBoxIndex(r, c);
        const entry = { mask, r, c };
        rowCells[r].push(entry);
        colCells[c].push(entry);
        boxCells[b].push(entry);
      }
    }
    return { rowCells, colCells, boxCells };
  }

  // ----------------------------------------------------------------
  // Naked Pairs
  // ----------------------------------------------------------------
  private applyNakedPairs(): boolean {
    let anyPruned = false;
    const N = this.size;
    const { rowCells, colCells, boxCells } = this.collectUnitCells();

    for (let i = 0; i < N; i++) {
      for (const unitCells of [rowCells[i], colCells[i], boxCells[i]]) {
        const masks = new Map<bigint, [number, number][]>();
        for (const { mask, r, c } of unitCells) {
          if (popcount(mask) === 2) {
            if (!masks.has(mask)) masks.set(mask, []);
            masks.get(mask)!.push([r, c]);
          }
        }
        for (const [mask, pairCells] of masks) {
          if (pairCells.length === 2) {
            const pairSet = new Set(pairCells.map(([r, c]) => `${r},${c}`));
            for (const { mask: m2, r: rr, c: cc } of unitCells) {
              if (pairSet.has(`${rr},${cc}`)) continue;
              if (m2 & mask) {
                let m = mask;
                while (m) {
                  const bit = m & (-m);
                  const d = bitLength(bit);
                  if (this.layers.isDigitPossibleAt(d, rr, cc)) {
                    this.layers.forbidChoice(d, rr, cc);
                    anyPruned = true;
                  }
                  m &= ~bit;
                }
              }
            }
          }
        }
      }
    }
    return anyPruned;
  }

  // ----------------------------------------------------------------
  // Naked Triples
  // ----------------------------------------------------------------
  private applyNakedTriples(): boolean {
    let anyPruned = false;
    const N = this.size;
    const { rowCells, colCells, boxCells } = this.collectUnitCells();

    for (let i = 0; i < N; i++) {
      for (const unitCells of [rowCells[i], colCells[i], boxCells[i]]) {
        const triples: { mask: bigint; r: number; c: number }[] = [];
        for (const entry of unitCells) {
          const pc = popcount(entry.mask);
          if (pc >= 2 && pc <= 3) triples.push(entry);
        }
        // All 3-combinations
        for (let a = 0; a < triples.length - 2; a++) {
          for (let b = a + 1; b < triples.length - 1; b++) {
            for (let ci = b + 1; ci < triples.length; ci++) {
              const union = triples[a].mask | triples[b].mask | triples[ci].mask;
              if (popcount(union) === 3) {
                const tripleSet = new Set([
                  `${triples[a].r},${triples[a].c}`,
                  `${triples[b].r},${triples[b].c}`,
                  `${triples[ci].r},${triples[ci].c}`,
                ]);
                for (const { mask, r: rr, c: cc } of unitCells) {
                  if (tripleSet.has(`${rr},${cc}`)) continue;
                  if (mask & union) {
                    let m = union;
                    while (m) {
                      const bit = m & (-m);
                      const d = bitLength(bit);
                      if (this.layers.isDigitPossibleAt(d, rr, cc)) {
                        this.layers.forbidChoice(d, rr, cc);
                        anyPruned = true;
                      }
                      m &= ~bit;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return anyPruned;
  }

  // ----------------------------------------------------------------
  // Hidden Pairs
  // ----------------------------------------------------------------
  private applyHiddenPairs(): boolean {
    let anyPruned = false;
    const N = this.size;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);

    // digit -> cells per unit
    const rowD2C: [number, number][][][] = Array.from({ length: N },
      () => Array.from({ length: N + 1 }, () => []));
    const colD2C: [number, number][][][] = Array.from({ length: N },
      () => Array.from({ length: N + 1 }, () => []));
    const boxD2C: [number, number][][][] = Array.from({ length: N },
      () => Array.from({ length: N + 1 }, () => []));

    const allMasks = this.layers.getAllAllowedMasks();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const mask = allMasks[r * N + c];
        if (!mask) continue;
        const b = this.layers.getBoxIndex(r, c);
        let curr = mask;
        while (curr) {
          const bit = curr & (-curr);
          const d = bitLength(bit);
          rowD2C[r][d].push([r, c]);
          colD2C[c][d].push([r, c]);
          boxD2C[b][d].push([r, c]);
          curr &= ~bit;
        }
      }
    }

    for (let i = 0; i < N; i++) {
      for (const d2c of [rowD2C[i], colD2C[i], boxD2C[i]]) {
        // Find digits with exactly 2 cells
        const pairs = new Map<number, string>();
        for (let d = 1; d <= N; d++) {
          if (d2c[d].length === 2) {
            const cells = d2c[d].slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            pairs.set(d, `${cells[0][0]},${cells[0][1]}|${cells[1][0]},${cells[1][1]}`);
          }
        }
        // Group by cell pair
        const rev = new Map<string, number[]>();
        for (const [d, key] of pairs) {
          if (!rev.has(key)) rev.set(key, []);
          rev.get(key)!.push(d);
        }
        for (const [key, digits] of rev) {
          if (digits.length === 2) {
            const maskToKeep = (1n << BigInt(digits[0] - 1)) | (1n << BigInt(digits[1] - 1));
            const parts = key.split('|');
            for (const part of parts) {
              const [rr, cc] = part.split(',').map(Number);
              const toRemove = this.layers.getAllowedMask(rr, cc) & ~maskToKeep;
              if (toRemove) {
                anyPruned = true;
                let m = toRemove;
                while (m) {
                  const bit = m & (-m);
                  this.layers.forbidChoice(bitLength(bit), rr, cc);
                  m &= ~bit;
                }
              }
            }
          }
        }
      }
    }
    return anyPruned;
  }

  // ----------------------------------------------------------------
  // Simple Coloring (X-chains)
  // ----------------------------------------------------------------
  private applySimpleColoring(): boolean {
    let anyPruned = false;
    const N = this.size;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);

    // Build per-digit, per-unit candidate lists
    const allRow: [number, number][][][] = Array.from({ length: N + 1 },
      () => Array.from({ length: N }, () => []));
    const allCol: [number, number][][][] = Array.from({ length: N + 1 },
      () => Array.from({ length: N }, () => []));
    const allBox: [number, number][][][] = Array.from({ length: N + 1 },
      () => Array.from({ length: N }, () => []));
    const allPossible: [number, number][][] = Array.from({ length: N + 1 }, () => []);

    const allMasks = this.layers.getAllAllowedMasks();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const mask = allMasks[r * N + c];
        if (!mask) continue;
        const b = this.layers.getBoxIndex(r, c);
        let curr = mask;
        while (curr) {
          const bit = curr & (-curr);
          const d = bitLength(bit);
          allRow[d][r].push([r, c]);
          allCol[d][c].push([r, c]);
          allBox[d][b].push([r, c]);
          allPossible[d].push([r, c]);
          curr &= ~bit;
        }
      }
    }

    for (let d = 1; d <= N; d++) {
      const adj = new Map<string, string[]>();
      for (const unitList of [allRow[d], allCol[d], allBox[d]]) {
        for (const candidates of unitList) {
          if (candidates.length === 2) {
            const u = `${candidates[0][0]},${candidates[0][1]}`;
            const v = `${candidates[1][0]},${candidates[1][1]}`;
            if (!adj.has(u)) adj.set(u, []);
            if (!adj.has(v)) adj.set(v, []);
            adj.get(u)!.push(v);
            adj.get(v)!.push(u);
          }
        }
      }
      if (!adj.size) continue;

      const visited = new Map<string, number>();
      for (const startCell of adj.keys()) {
        if (visited.has(startCell)) continue;
        const component: [string, number][] = [];
        const queue: [string, number][] = [[startCell, 0]];
        visited.set(startCell, 0);
        let idx = 0;
        while (idx < queue.length) {
          const [u, color] = queue[idx++];
          component.push([u, color]);
          for (const v of adj.get(u) ?? []) {
            if (!visited.has(v)) {
              visited.set(v, 1 - color);
              queue.push([v, 1 - color]);
            }
          }
        }

        const colorGroups: string[][] = [[], []];
        for (const [cell, color] of component) colorGroups[color].push(cell);

        // Build unit sets for Rule 1 + Rule 2
        const seenRows: Set<number>[] = [new Set(), new Set()];
        const seenCols: Set<number>[] = [new Set(), new Set()];
        const seenBoxes: Set<number>[] = [new Set(), new Set()];
        let invalidColor = -1;

        for (let color = 0; color <= 1; color++) {
          for (const cell of colorGroups[color]) {
            const [cr, cc] = cell.split(',').map(Number);
            const boxId = Math.floor(cr / bs) * bsCols + Math.floor(cc / bs);
            if (invalidColor === -1) {
              if (seenRows[color].has(cr) || seenCols[color].has(cc) || seenBoxes[color].has(boxId)) {
                invalidColor = color;
              }
            }
            seenRows[color].add(cr);
            seenCols[color].add(cc);
            seenBoxes[color].add(boxId);
          }
        }

        if (invalidColor !== -1) {
          for (const cell of colorGroups[invalidColor]) {
            const [r, c] = cell.split(',').map(Number);
            this.layers.forbidChoice(d, r, c);
            anyPruned = true;
          }
          continue;
        }

        // Rule 2
        const inComponent = new Set(component.map(([cell]) => cell));
        for (const [r, c] of allPossible[d]) {
          const key = `${r},${c}`;
          if (inComponent.has(key)) continue;
          const boxId = Math.floor(r / bs) * bsCols + Math.floor(c / bs);
          const sees0 = seenRows[0].has(r) || seenCols[0].has(c) || seenBoxes[0].has(boxId);
          const sees1 = seenRows[1].has(r) || seenCols[1].has(c) || seenBoxes[1].has(boxId);
          if (sees0 && sees1) {
            this.layers.forbidChoice(d, r, c);
            anyPruned = true;
          }
        }
      }
    }
    return anyPruned;
  }

  // ----------------------------------------------------------------
  // Contradiction check
  // ----------------------------------------------------------------
  checkForContradictions(): void {
    const N = this.size;
    const fullMask = this.layers.fullMask;
    const bs = this.grid.boxSize;
    const bsCols = Math.floor(N / bs);

    // Zero-candidate check + row/col/box union
    const rowUnion = new Array<bigint>(N).fill(0n);
    const colUnion = new Array<bigint>(N).fill(0n);
    const boxUnion = new Array<bigint>(N).fill(0n);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (this.grid.isEmpty(r, c)) {
          const mask = this.layers.getAllowedMask(r, c);
          if (mask === 0n) {
            this.visual.markContradictionCell(r, c);
            throw new Contradiction(`Cell (${r},${c}) has no allowed digits.`);
          }
          const b = this.layers.getBoxIndex(r, c);
          rowUnion[r] |= mask;
          colUnion[c] |= mask;
          boxUnion[b] |= mask;
        }
      }
    }

    for (let i = 0; i < N; i++) {
      if ((rowUnion[i] | this.layers.rowMasks[i]) !== fullMask)
        throw new Contradiction(`Row ${i} is missing some digits.`);
      if ((colUnion[i] | this.layers.colMasks[i]) !== fullMask)
        throw new Contradiction(`Col ${i} is missing some digits.`);
      if ((boxUnion[i] | this.layers.boxMasks[i]) !== fullMask)
        throw new Contradiction(`Box ${i} is missing some digits.`);
    }
  }

  private get size() { return this.grid.size; }
}
