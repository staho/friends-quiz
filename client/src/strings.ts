export const NBSP = " "

/** Polish plural: 1 → one; 2–4 (not 12–14) → few; else (0, 5–21, 25…) → many. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n))
  if (abs === 1) return one
  const d = abs % 10
  const h = abs % 100
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few
  return many
}

/** Integers. 950 → "950", 3450 → "3 450", 12345 → "12 345" (U+00A0). Negatives get a plain "-". */
export function formatNumber(n: number): string {
  const sign = n < 0 ? "-" : ""
  const digits = String(Math.abs(Math.round(n)))
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** Lock time: under 10 s one decimal with comma ("1,7 s", "0 s" → "0,0 s"), from 10 s whole ("12 s"). */
export function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000
  const text = s >= 10 ? String(Math.round(s)) : (Math.round(s * 10) / 10).toFixed(1).replace(".", ",")
  return `${text}${NBSP}s`
}

/** Replaces `{name}` placeholders in a template. Unknown placeholders stay as they are. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
}

export const t = {
  // --- server errors ---
  errRoomNotFound: "Nie ma takiego pokoju. Sprawdź kod.",
  errRejoin: "Dołącz do pokoju jeszcze raz.",
  errNameEmpty: "Wpisz imię.",
  errNameTooLong: "Za długie imię (maks. 16 znaków).",
  errNameTaken: "To imię jest już zajęte.",
  errRoomFull: "W pokoju nie ma już miejsca.",
  errTooManyJoins: "Za dużo prób naraz. Poczekaj chwilę i spróbuj jeszcze raz.",
  errHostOnly: "Najpierw otwórz ekran prowadzącego.",
  errJoinFirst: "Najpierw dołącz do pokoju.",
  errNoPlayers: "Poczekaj, aż dołączy choć jeden gracz.",
  errAlreadyStarted: "Runda już się zaczęła.",
  errNotStarted: "Runda jeszcze się nie zaczęła.",
  errNoQuestionOpen: "Teraz nie ma otwartego pytania.",
  errTimeUp: "Czas minął.",
  errBadChoice: "Wybierz jedną z czterech odpowiedzi.",
  errPickFirst: "Najpierw wybierz odpowiedź.",
  errAnswerLocked: "Odpowiedź jest już zatwierdzona.",
  errNothingToPause: "Nie ma czego zatrzymać.",
  errRevealFirst: "Najpierw pokaż odpowiedź.",
  errNoQuestions: "Skończyły się pytania.",
  errAnswerTimeRange: "Czas na odpowiedź: od {min} do {max} sekund.",
  errNextTimeRange: "Czas do następnego pytania: od {min} do {max} sekund.",
  errBadRequest: "Coś poszło nie tak. Spróbuj jeszcze raz.",
  errServer: "Coś poszło nie tak.",
  errRateLimited: "Za szybko. Poczekaj chwilę i spróbuj jeszcze raz.",
  errCouldNotOpenRoom: "Nie udało się otworzyć pokoju.",
  errReconnecting: "Łączę ponownie…",
  errNoReply: "Stolik nie odpowiada. Spróbuj jeszcze raz.",
  errUnreachable: "Nie można połączyć się ze stolikiem.",

  // --- WP2 TV ---
  // --- end WP2 TV ---

  // --- WP4 connection ---
  // --- end WP4 connection ---

  // --- WP5 TV data ---
  // --- end WP5 TV data ---

  // --- WP6 phone ---
  // --- end WP6 phone ---

  // --- WP7 meta ---
  // --- end WP7 meta ---
} as const
