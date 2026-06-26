/** Jour calendaire au format YYYY-MM-DD en fuseau Europe/Paris. */
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function parisDay(d: Date = new Date()): string {
  return PARIS_DAY.format(d);
}

/** Jour (Europe/Paris) il y a `days` jours. */
export function dayMinus(days: number, from: Date = new Date()): string {
  return PARIS_DAY.format(new Date(from.getTime() - days * 86_400_000));
}
