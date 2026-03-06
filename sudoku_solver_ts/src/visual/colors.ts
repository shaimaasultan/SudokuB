export function generateDigitColors(n: number): Map<number, string> {
  const colors = new Map<number, string>();
  for (let d = 1; d <= n; d++) {
    const t = (d - 1) / Math.max(1, n - 1);
    const r = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + 0.0));
    const g = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + 1 / 3));
    const b = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + 2 / 3));
    const R = Math.round(r * 255);
    const G = Math.round(g * 255);
    const B = Math.round(b * 255);
    colors.set(d, `#${R.toString(16).padStart(2, '0')}${G.toString(16).padStart(2, '0')}${B.toString(16).padStart(2, '0')}`);
  }
  return colors;
}
