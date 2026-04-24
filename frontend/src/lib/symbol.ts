export function normalizeSymbol(s?: string | null): string {
  return (s ?? '').toUpperCase().trim()
}

export function eqSym(a?: string | null, b?: string | null): boolean {
  return normalizeSymbol(a) === normalizeSymbol(b)
}

export function includesSym(field?: string | null, q?: string | null): boolean {
  if (!q) return true
  return normalizeSymbol(field).includes(normalizeSymbol(q))
}
