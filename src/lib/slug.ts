/** Valide un slug ARPEJ (minuscules, chiffres, tirets). */
export function isValidSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

/** Transforme un slug en titre lisible (fallback quand la résidence est absente de l'API). */
export function prettifySlug(s: string): string {
  return s
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
