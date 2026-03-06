declare const process: { argv: string[] };

import { SudokuSolver } from './solver';
import { generatePuzzle, setSeed } from './examples/puzzles';
import { digitToSymbol } from './visual/symbols';

function formatGrid(values: Int32Array, size: number): string {
  const lines: string[] = [];
  const bs = Math.round(Math.sqrt(size));
  const cellWidth = size > 9 ? 3 : 2;

  for (let r = 0; r < size; r++) {
    if (r > 0 && r % bs === 0) {
      lines.push('-'.repeat(size * cellWidth + (Math.floor(size / bs) - 1) * 2));
    }
    const parts: string[] = [];
    for (let c = 0; c < size; c++) {
      if (c > 0 && c % bs === 0) parts.push('|');
      const v = values[r * size + c];
      const sym = v === 0 ? '.' : digitToSymbol(v);
      parts.push(sym.padStart(cellWidth));
    }
    lines.push(parts.join(''));
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const sizeArg = args.find((a: string) => a.startsWith('--size='));
  const densityArg = args.find((a: string) => a.startsWith('--density='));
  const seedArg = args.find((a: string) => a.startsWith('--seed='));

  const size = sizeArg ? parseInt(sizeArg.split('=')[1]) : 9;
  const density = densityArg ? parseFloat(densityArg.split('=')[1]) : undefined;
  const seed = seedArg ? parseInt(seedArg.split('=')[1]) : 32678;

  setSeed(seed);

  console.log(`Generating ${size}x${size} puzzle (seed=${seed})...`);
  const puzzle = generatePuzzle(size, density);

  console.log('\nPuzzle:');
  const puzzleGrid = new Int32Array(size * size);
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      puzzleGrid[r * size + c] = puzzle[r][c];
  console.log(formatGrid(puzzleGrid, size));

  console.log('\nSolving...');
  const solver = new SudokuSolver(size);
  const solution = solver.solve(puzzle);

  if (solution) {
    console.log(`\nSolved in ${solver.lastSolveTime.toFixed(3)}s`);
    console.log(formatGrid(solution.values, size));
  } else {
    console.log('\nNo solution found.');
  }
}

main();
