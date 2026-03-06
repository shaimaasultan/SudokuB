export function digitToSymbol(d: number): string {
  if (d >= 1 && d <= 9) return String(d);
  if (d >= 10 && d <= 35) return String.fromCharCode(65 + d - 10); // A-Z
  if (d >= 36 && d <= 61) return String.fromCharCode(97 + d - 36); // a-z
  return d > 0 ? String(d) : '';
}
