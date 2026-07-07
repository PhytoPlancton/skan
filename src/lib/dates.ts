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

const PARIS_TIME = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Minutes écoulées depuis minuit, heure de Paris. */
export function parisMinutesOfDay(d: Date = new Date()): number {
  const [h, m] = PARIS_TIME.format(d).split(":").map(Number);
  return h * 60 + m;
}

/** "HH:MM" → minutes depuis minuit. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
