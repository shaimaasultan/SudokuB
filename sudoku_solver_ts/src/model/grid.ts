/**
 * N×N Sudoku grid backed by a flat Int32Array for cache-friendly access.
 */
export class Grid {
  readonly size: number;
  readonly boxSize: number;
  values: Int32Array;

  constructor(size: number, values?: number[][]) {
    this.size = size;
    this.boxSize = Math.round(Math.sqrt(size));
    if (this.boxSize * this.boxSize !== size) {
      throw new Error('Grid size must be a perfect square (e.g., 9, 16, 25).');
    }
    this.values = new Int32Array(size * size);
    if (values) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          this.values[r * size + c] = values[r][c];
        }
      }
    }
  }

  clone(): Grid {
    const g = new Grid(this.size);
    g.values.set(this.values);
    return g;
  }

  get(r: number, c: number): number {
    return this.values[r * this.size + c];
  }

  set(r: number, c: number, v: number): void {
    this.values[r * this.size + c] = v;
  }

  isEmpty(r: number, c: number): boolean {
    return this.values[r * this.size + c] === 0;
  }

  toString(): string {
    const lines: string[] = [];
    for (let r = 0; r < this.size; r++) {
      const parts: string[] = [];
      for (let c = 0; c < this.size; c++) {
        const v = this.get(r, c);
        parts.push(v === 0 ? '.' : String(v));
      }
      lines.push(parts.join(' '));
    }
    return lines.join('\n');
  }
}
