import { Grid } from './model/grid';
import { LayerManager } from './layers/layers';
import { Propagator, Contradiction } from './propagation/propagator';
import { BranchingEngine, SearchRestart } from './branching/branching';
import { VisualHooks, NO_OP_VISUAL } from './visual/visual-hooks';

export class SudokuSolver {
  readonly size: number;
  private visual: VisualHooks;
  lastSolveTime = 0;
  stopRequested = false;

  constructor(size = 9, visual?: VisualHooks) {
    this.size = size;
    this.visual = visual ?? NO_OP_VISUAL;
  }

  solve(values: number[][]): Grid | null {
    const start = performance.now();
    this.stopRequested = false;

    let grid = new Grid(this.size, values);
    let layers = new LayerManager(grid);
    let propagator = new Propagator(grid, layers, this.visual);
    let engine = new BranchingEngine(grid, layers, propagator, this.visual);
    engine.stopRequested = () => this.stopRequested;

    // Initial propagation
    layers.rebuildAllLayers();
    try {
      propagator.runPropagation(() => this.stopRequested);
    } catch (e) {
      if (e instanceof Contradiction) {
        this.lastSolveTime = (performance.now() - start) / 1000;
        return null;
      }
      throw e;
    }

    if (this.stopRequested) {
      this.lastSolveTime = (performance.now() - start) / 1000;
      return null;
    }

    // Branching search with restarts
    const maxRestarts = Math.max(5, Math.floor(this.size / 3));
    let solutionFound = false;

    for (let attempt = 0; attempt < maxRestarts; attempt++) {
      if (this.stopRequested) {
        this.lastSolveTime = (performance.now() - start) / 1000;
        return null;
      }

      try {
        const ok = engine.solveWithBranching();
        if (ok) { solutionFound = true; break; }
        else {
          this.lastSolveTime = (performance.now() - start) / 1000;
          return null;
        }
      } catch (e) {
        if (e instanceof SearchRestart) {
          if (this.stopRequested) {
            this.lastSolveTime = (performance.now() - start) / 1000;
            return null;
          }
          const savedTryCounts = engine.tryCounts;
          const savedUnitTryCounts = engine.unitTryCounts;
          const savedHotPairCount = engine.hotPairCount;
          engine.decayCounts();
          // Re-init from scratch but preserve learned counts
          grid = new Grid(this.size, values);
          layers = new LayerManager(grid);
          propagator = new Propagator(grid, layers, this.visual);
          engine = new BranchingEngine(grid, layers, propagator, this.visual);
          engine.stopRequested = () => this.stopRequested;
          engine.tryCounts = savedTryCounts;
          engine.unitTryCounts = savedUnitTryCounts;
          engine.hotPairCount = savedHotPairCount;
          layers.rebuildAllLayers();
          try {
            propagator.runPropagation(() => this.stopRequested);
          } catch (e2) {
            if (e2 instanceof Contradiction) {
              this.lastSolveTime = (performance.now() - start) / 1000;
              return null;
            }
            throw e2;
          }
        } else {
          throw e;
        }
      }
    }

    this.lastSolveTime = (performance.now() - start) / 1000;
    if (!solutionFound || !engine.isSolved()) return null;
    return engine.grid;
  }
}
