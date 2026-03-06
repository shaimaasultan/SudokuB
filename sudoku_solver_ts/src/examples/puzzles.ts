/**
 * Random puzzle generator. Uses shift-based construction + random transforms.
 */

import { Grid } from '../model/grid';
import { LayerManager } from '../layers/layers';
import { Propagator, Contradiction } from '../propagation/propagator';
import { NO_OP_VISUAL } from '../visual/visual-hooks';

// Simple seedable PRNG (xoshiro128** variant)
class Random {
  private s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    this.s[0] = seed >>> 0;
    this.s[1] = (seed * 1664525 + 1013904223) >>> 0;
    this.s[2] = (this.s[1] * 1664525 + 1013904223) >>> 0;
    this.s[3] = (this.s[2] * 1664525 + 1013904223) >>> 0;
  }

  next(): number {
    const s = this.s;
    const result = (((s[1] * 5) << 7 | (s[1] * 5) >>> 25) * 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = (s[3] << 11 | s[3] >>> 21);
    return result;
  }

  /** Random float in [0, 1) */
  random(): number {
    return this.next() / 0x100000000;
  }

  /** Shuffle array in-place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.next() % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

let globalRng = new Random(32678);

export function setSeed(seed: number): void {
  globalRng = new Random(seed);
}

/** Build a complete valid solution grid. */
function buildFullSolution(size: number, box: number): number[][] {
  const rng = globalRng;
  const base: number[][] = Array.from({ length: size }, () => new Array<number>(size));
  for (let r = 0; r < size; r++) {
    const shift = (r * box + Math.floor(r / box)) % size;
    for (let c = 0; c < size; c++) {
      base[r][c] = (shift + c) % size + 1;
    }
  }
  const digits = Array.from({ length: size }, (_, i) => i + 1);
  rng.shuffle(digits);
  const mapping = new Map<number, number>();
  for (let i = 0; i < size; i++) mapping.set(i + 1, digits[i]);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      base[r][c] = mapping.get(base[r][c])!;
  for (let b = 0; b < box; b++) {
    const rows = Array.from({ length: box }, (_, i) => b * box + i);
    rng.shuffle(rows);
    const newBlock = rows.map(r => base[r].slice());
    for (let i = 0; i < box; i++) base[b * box + i] = newBlock[i];
  }
  for (let b = 0; b < box; b++) {
    const cols = Array.from({ length: box }, (_, i) => b * box + i);
    rng.shuffle(cols);
    for (let r = 0; r < size; r++) {
      const rowCopy = base[r].slice();
      for (let i = 0; i < box; i++) base[r][b * box + i] = rowCopy[cols[i]];
    }
  }
  return base;
}

function generateDynamicPuzzle(size: number, box: number, density: number): number[][] {
  const base = buildFullSolution(size, box);
  const rng = globalRng;
  const puzzle: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (rng.random() < density) puzzle[r][c] = base[r][c];
  return puzzle;
}

/**
 * Balanced removal: remove cells from a complete solution, but guarantee
 * at least `box` clues per unit so propagation always has enough to work.
 */
function generateByRemoval(size: number, box: number, density: number): number[][] {
  const base = buildFullSolution(size, box);
  const rng = globalRng;
  const N = size;
  const totalCells = N * N;
  const targetRemovals = totalCells - Math.round(totalCells * density);
  // Guarantee at least box clues per unit (min for hidden singles to fire)
  const maxBlanksPerUnit = Math.min(Math.ceil(N * (1 - density)) + 1, N - box);

  const puzzle = base.map(row => row.slice());
  const rowBlanks = new Int32Array(N);
  const colBlanks = new Int32Array(N);
  const boxBlanks = new Int32Array(N);

  const positions: [number, number][] = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      positions.push([r, c]);
  rng.shuffle(positions);

  let removed = 0;
  for (const [r, c] of positions) {
    if (removed >= targetRemovals) break;
    const b = Math.floor(r / box) * box + Math.floor(c / box);
    if (rowBlanks[r] >= maxBlanksPerUnit ||
        colBlanks[c] >= maxBlanksPerUnit ||
        boxBlanks[b] >= maxBlanksPerUnit) continue;
    puzzle[r][c] = 0;
    rowBlanks[r]++;
    colBlanks[c]++;
    boxBlanks[b]++;
    removed++;
  }
  return puzzle;
}

export function examplePuzzle9(density = 0.45): number[][] {
  return generateDynamicPuzzle(9, 3, density);
}

export function examplePuzzle16(density = 0.5): number[][] {
  return generateDynamicPuzzle(16, 4, density);
}

export function examplePuzzle25(density = 0.55): number[][] {
  return generateDynamicPuzzle(25, 5, density);
}

export function examplePuzzle36(density = 0.6): number[][] {
  return generateDynamicPuzzle(36, 6, density);
}

export function examplePuzzle49(density = 0.65): number[][] {
  return generateDynamicPuzzle(49, 7, density);
}

export function examplePuzzle64(density = 0.7): number[][] {
  return generateDynamicPuzzle(64, 8, density);
}

export function generatePuzzle(size: number, density?: number): number[][] {
  const box = Math.round(Math.sqrt(size));
  const defaultDensity: Record<number, number> = { 9: 0.45, 16: 0.5, 25: 0.55, 36: 0.6, 49: 0.65, 64: 0.7 };
  return generateDynamicPuzzle(size, box, density ?? defaultDensity[size] ?? 0.5);
}

/**
 * Rate puzzle difficulty: returns the number of empty cells with ≥2 candidates
 * after full constraint propagation. Lower = easier.
 */
export function ratePuzzleDifficulty(size: number, puzzle: number[][]): number {
  try {
    const grid = new Grid(size, puzzle);
    const layers = new LayerManager(grid);
    const propagator = new Propagator(grid, layers, NO_OP_VISUAL);
    layers.rebuildAllLayers();
    try {
      propagator.runPropagation(() => false);
    } catch (e) {
      if (e instanceof Contradiction) return size * size;
      throw e;
    }
    const allMasks = layers.getAllAllowedMasks();
    const N = size;
    let ambiguous = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (grid.get(r, c) === 0) {
          let mask = allMasks[r * N + c];
          let count = 0;
          while (mask) { mask &= mask - 1n; count++; }
          if (count >= 2) ambiguous++;
        }
      }
    }
    return ambiguous;
  } catch {
    return size * size;
  }
}

/**
 * Generate the easiest puzzle out of several candidates.
 * Easiest = fewest cells with ≥2 candidates after propagation.
 */
export function generateBestPuzzle(size: number, density?: number): number[][] {
  const box = Math.round(Math.sqrt(size));
  const defaultDensity: Record<number, number> = { 9: 0.45, 16: 0.5, 25: 0.55, 36: 0.6, 49: 0.65, 64: 0.7 };
  const d = density ?? defaultDensity[size] ?? 0.5;
  const candidates = size >= 25 ? 8 : (size >= 16 ? 5 : 3);
  let bestPuzzle: number[][] | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < candidates; i++) {
    setSeed(52 * (i + 1));
    const puzzle = generateByRemoval(size, box, d);
    const score = ratePuzzleDifficulty(size, puzzle);
    if (score < bestScore) {
      bestScore = score;
      bestPuzzle = puzzle;
    }
    if (score === 0) break;
  }
  return bestPuzzle!;
}
