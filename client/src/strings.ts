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

export const formatPoints = (n: number) => `${formatNumber(n)}${NBSP}pkt`
const secondsWord = (n: number) => plural(n, "sekunda", "sekundy", "sekund")
const playersWord = (n: number) => plural(n, "gracz", "gracze", "graczy")
const pointsWord = (n: number) => plural(n, "punkt", "punkty", "punktów")
const wholeSeconds = (n: number) => `${n}${NBSP}s`

const CATEGORY_LABELS: Record<string, string> = {
  geography: "Geografia",
  science: "Nauka i przyroda",
  common: "Wiedza ogólna",
  movies: "Film i seriale",
  history: "Historia",
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

  // --- interface ---
  appName: "Quiz ze znajomymi",
  mute: "Wycisz",
  unmute: "Włącz dźwięk",
  fullScreen: "Pełny ekran",
  exitFullScreen: "Zamknij pełny ekran",
  fullScreenUnavailable: "Ta przeglądarka nie obsługuje pełnego ekranu",
  reconnecting: "Łączę ponownie…",
  findingSeat: "Szukam twojego miejsca…",
  settingUp: "Szykuję grę…",
  couldNotJoin: "Nie udało się dołączyć",
  couldNotOpen: "Nie udało się otworzyć pokoju",
  tryAgain: "Spróbuj jeszcze raz",
  joinTitle: "Dosiądź się",
  roomCode: "Kod pokoju",
  yourName: "Twoje imię",
  join: "Dołącz",
  hostGame: "Otwórz grę na TV",
  youreIn: "Jesteś w grze",
  tvStarts: "Rundę startuje telewizor.",
  leave: "Wyjdź",
  lockedIn: "Zatwierdzone",
  canChange: "Możesz zmienić, dopóki nie zatwierdzisz.",
  lockIn: "Zatwierdź",
  timesUp: "Koniec czasu",
  wrong: "Tym razem nie",
  yourScore: "Twój wynik",
  roundOver: "Koniec rundy",
  scoresOnTv: "Pełne wyniki są na telewizorze.",
  getReady: "Przygotuj się",
  noLockPace: "Bez zatwierdzenia liczy się cały czas.",
  joinOnPhone: "Dołącz telefonem",
  start: "Zaczynamy",
  waitingFirst: "Czekam na pierwszy telefon.",
  end: "Zakończ",
  next: "Dalej",
  pause: "Pauza",
  resume: "Wznów",
  nextNow: "Już następne pytanie",
  theAnswer: "Poprawna odpowiedź",
  holding: "Pauza",
  spacePauses: "Spacja – pauza",
  noAnswer: "brak odpowiedzi",
  miss: "pudło",
  notLocked: "bez zatwierdzenia",
  finalTable: "Wyniki końcowe",
  newRound: "Nowa runda",
  nobodyPlayed: "Nikt nie zagrał.",
  roundSettings: "Ustawienia rundy",
  answerTime: "Czas na odpowiedź",
  autoNext: "Następne pytanie automatycznie",
  nextTime: "Czas do następnego pytania",
  difficulty: "Poziom trudności",
  bandMixed: "1–5",

  progress: (n: number, total: number) => `${n} / ${total}`,
  correctGain: (points: number) => `Dobrze! +${formatNumber(points)}`,
  place: (n: number) => `${n}. miejsce`,
  finalLine: (n: number, score: number) => `${n}. miejsce · ${formatPoints(score)}`,
  questionOf: (n: number, total: number) => `Pytanie ${n} z ${total}`,
  questionKicker: (n: number, total: number, level: number) => `Pytanie ${n} z ${total} · Poziom ${level}`,
  lockedAt: (ms: number) => `Zatwierdzone po ${formatSeconds(ms)}.`,
  lockedCount: (locked: number, active: number) => `Zatwierdzone: ${locked} z ${active}`,
  waitingOn: (names: string[]) => ` · czekamy na: ${names.join(", ")}`,
  roomCodeAria: (code: string) => `Kod pokoju ${code}`,
  scanToJoin: (url: string) => `Zeskanuj, żeby dołączyć: ${url}`,
  secondsLeft: (n: number) => `${plural(n, "Została", "Zostały", "Zostało")} ${n} ${secondsWord(n)}`,
  secondsUnit: (n: number | null) => (n === null ? "s" : secondsWord(n)),
  nextTimeHint: (n: number | null) =>
    `${n === null ? "s" : secondsWord(n)} z odpowiedzią na ekranie, potem 3${NBSP}s odliczania`,
  holdingLeft: (n: number) => `Pauza · zostało ${wholeSeconds(n)}`,
  nextIn: (n: number) => `Następne pytanie za ${wholeSeconds(n)}`,
  players: (n: number) => `${n} ${playersWord(n)}`,
  points: (n: number) => `${formatNumber(n)} ${pointsWord(n)}`,

  // --- WP2 TV ---
  hostReconnecting: "Łączę z twoim pokojem…",
  newRoom: "Nowy pokój",
  newRoomConfirm: "Naciśnij jeszcze raz: nowy pokój",
  endConfirm: "Naciśnij jeszcze raz, żeby zakończyć",
  keysHint: "Enter / → – dalej · Spacja – pauza",
  answerTimeNextQuestion: "Zadziała od następnego pytania",
  // --- end WP2 TV ---

  // --- WP4 connection ---
  // --- end WP4 connection ---

  // --- WP5 TV data ---
  pickedBy: "Wybrało: {n}",
  joinedLate: "dołączenie w trakcie",
  nextCategory: "Następna: {category}",
  removePlayer: "Usuń gracza {name}",
  removeConfirm: "Usunąć?",
  dealRetrying: "Nie udało się wczytać następnego pytania, próbuję jeszcze raz…",
  podiumTitle: "Podium",
  moveUp: "w górę o {n}",
  moveDown: "w dół o {n}",
  categoryLabel: (id: string) => CATEGORY_LABELS[id] ?? id,
  // --- end WP5 TV data ---

  // --- WP6 phone ---
  roomGone: "Tego pokoju już nie ma. Poproś o nowy kod z telewizora.",
  seatLost: "Dołącz jeszcze raz.",
  removedByHost: "Usunięto cię z gry.",
  youLead: "1. miejsce · prowadzisz",
  tiedFirst: "1. miejsce ex aequo",
  placeGap: "{rank}. miejsce · {gap} do lidera",
  joinedLateWait: "Runda już trwa. Wskakujesz od następnego pytania.",
  secsLeftShort: (n: number) => `${n}${NBSP}s`,
  changeHint: "Możesz jeszcze zmienić.",
  // --- end WP6 phone ---

  // --- WP7 meta ---
  // --- end WP7 meta ---
} as const
