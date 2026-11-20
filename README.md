# Friends Quiz

A pub quiz for one TV and a phone per player. The TV shows the question and four answers. Each phone locks in one answer. A Cloudflare Worker keeps the timer, the scores, and the question bank. The interface and the questions are in Polish.

## How it plays

1. The TV opens a room at `/host` and shows a four-letter code and a QR code. Players join at the site address on their phones with the code and a name (16 characters at most). The host presses **Zaczynamy**, or Enter on the remote, once someone is in. A room holds 20 players.
2. A 3 second **Przygotuj się** countdown comes first. Then a question stays open for 20 seconds. The four answers are shuffled when the question is dealt, so the right one is not always in the same place. A player can change the selected answer until they press **Zatwierdź** or the timer ends. The phone shows the seconds left and the player's points.
3. The question reveals early when every connected player has locked in.
4. The answer stays up for 8 seconds, then a 3 second get-ready countdown. The host can change that wait, turn it off, or pause it. The countdown on the answer includes the get-ready time. **Pauza** or the space bar holds the countdown. **Dalej** skips the wait. **Zakończ** jumps to the podium, after a second press within 4 seconds.
5. A round is 10 questions, two from each difficulty level, played from warm-up to expert. The next one is chosen when the host starts or the countdown ends, from unused questions at that level. Categories are dealt evenly inside a round, and the TV shows the category of each question. If the next question cannot be loaded, the TV says so and tries again.

A correct answer scores 500 points, plus up to 500 more for an instant lock. The time of a lock is frozen at the moment of the tap. A correct pick that was never locked in scores 500, the same as a lock as the timer ends. A wrong answer or no answer scores 0. The formula is `scoreAnswer` in [`server/game.ts`](server/game.ts). Each answer is kept on the room, with the question category and difficulty, so a later picker can use how the table is doing. The answer time and the wait before the next question can be changed in **Ustawienia rundy**. A new answer time applies from the next question.

On the reveal the TV lists everyone in rank order, with an arrow for each place gained or lost since the reveal before (none on the first question of a round), how many players picked each answer, and each player's points and lock time. At the end it builds a podium from third place up to first, with the rest of the players in a list below it. The phone shows the player's place and the gap to the leader during the reveal.

A player can join after the round has started. They start with 0 points. Joining in the middle of a question lets them answer it, and the TV counts them in **Zatwierdzone** and waits for them like anyone else. Joining during a reveal shows them "Runda już trwa" until the next question, and the TV marks them **dołączenie w trakcie** on that reveal. A player who loses connection keeps their seat. Joining again with the same name takes it back. The host can remove a player with the **×** next to the name in the lobby, in the list of players still to answer, and on away rows of the reveal. It asks **Usunąć?** and needs a second press. The removed phone returns to the join form with a message. A player can press **Wyjdź** on their phone. In the lobby and on the final board it frees the seat at once. During a round it is a small button at the top that needs a second tap (**Na pewno wyjść?**). The player then stops counting: the TV does not wait for them, they take no place, and the standings list them last as **wyszedł** with the points they had earned. They are dropped when the round ends or a new round starts, and they never show up in a later reveal as "brak odpowiedzi".

The TV remembers its room. Refresh it, or close the tab and open `/host` again in the same browser, and it returns to the same room with the same scores. **Nowy pokój** (two presses) opens a fresh room with a new code. **Nowa runda** keeps the room code, clears scores, and deals a new set of questions.

Keys on the TV, for a remote or a keyboard: Enter, the right arrow and Page Down press **Zaczynamy** in the lobby and **Dalej** on a reveal. Space pauses and resumes an automatic reveal. A focused button keeps its own Enter and Space.

A room that nobody has touched for 2 days is deleted with everything in it. The TV and phones keep their saved sessions a day longer than that and then forget them.

Limits: 20 players per room, names up to 16 characters, 10 join attempts per connection, and 10 new rooms per minute from one address. An answer time is 5 to 120 seconds and the wait for the next question 2 to 30 seconds.

## Architecture

- **Client.** React screens in [`client/src/screens/`](client/src/screens/). Vite builds them into `client/dist`. The Worker serves that folder as static assets.
- **Worker.** [`worker/index.ts`](worker/index.ts) opens rooms and routes sockets. `POST /api/rooms` creates a room, rate limited per address. `/ws/:code` is the game socket. Every other path is the site, served from the static assets, with a link preview image, icons and a web manifest in [`client/public/`](client/public/).
- **Room.** One `RoomDurableObject` per room code. It runs the rules in [`server/game.ts`](server/game.ts), handles one message at a time, holds the live WebSockets, and sets an alarm for the question timer, the pause before the next question, and the removal of an idle room.
- **Catalog.** One `CatalogDurableObject` holds the question bank and picks the next unused question at the current difficulty.

## Dependencies

React 19, Vite, TypeScript, and Wrangler. Node 22 runs the tests, and `playwright-core` drives the browser test.

## Data

SQLite lives inside the Durable Objects.

The catalog object creates these tables on first start from [`migrations/0001_questions.sql`](migrations/0001_questions.sql), then loads [`migrations/0002_seed.sql`](migrations/0002_seed.sql). Later migration files add categories and questions. The object applies each file once. `0010_polish_switch.sql` gives the categories Polish labels and retires the English questions (`active = 0`; rows stay because `question_stats` and `question_plays` reference them). `0011`–`0015` add the Polish bank, one file per category.

| Table | Stores |
| --- | --- |
| `categories` | id, label (Polish) |
| `questions` | prompt, category, difficulty (1–5), active |
| `choices` | four answers per question, one marked correct |

[`data/COVERAGE.md`](data/COVERAGE.md) records how full each category and difficulty level is.

The room object keeps a single `room` row (`id` = 1, `data` = the live game as JSON): phase, players, scores, and answers. Both objects keep that data across deploys.

## Connections

Each browser opens one WebSocket to `/ws/CODE`. The server pushes `state`. The client sends the events in [`shared/wire.ts`](shared/wire.ts), and each one gets a reply that is either ok or an error code:

- Host: `host:attach`, `host:start`, `host:next`, `host:pause`, `host:end`, `host:reset`, `host:settings`, `host:remove`
- Player: `player:join`, `player:attach`, `player:choose`, `player:lock`, `player:leave`

The server never sends display text. A failure is a stable code from [`shared/errors.ts`](shared/errors.ts), and the client turns it into Polish in [`client/src/strings.ts`](client/src/strings.ts), which holds every string on screen. The codes are `room_not_found`, `rejoin`, `name_empty`, `name_too_long`, `name_taken`, `room_full`, `too_many_joins`, `host_only`, `join_first`, `no_players`, `already_started`, `not_started`, `no_question_open`, `time_up`, `bad_choice`, `pick_first`, `answer_locked`, `nothing_to_pause`, `reveal_first`, `no_questions`, `answer_time_range`, `next_time_range`, `bad_request`, `server_error`, `rate_limited` and `could_not_open_room`. The client adds `reconnecting`, `no_reply` and `unreachable`.

The TV creates the room with `POST /api/rooms` and stores the host token in `localStorage`, under `fq:host:CODE`, with `fq:host:last` naming the room to return to. Phones store the player token under `fq:player:CODE` and `fq:player:last` the same way, so a refresh or a second tab reattaches. Old sessions are cleared after three days.

## Deployment

```bash
npm install
npm run dev
```

`npm run dev` builds the client and starts Wrangler. Open the TV at [http://localhost:8787/host](http://localhost:8787/host). On your own Wi-Fi, use the network address Wrangler prints so phones can join.

`npm run deploy` publishes the Worker. A push to `main` runs the unit, Worker and browser tests and the typecheck, then deploys through GitHub Actions, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, to [friends-quiz.staho.dev](https://friends-quiz.staho.dev). A pull request deploys a separate Workers preview at `friends-quiz-pr-<number>.staho.dev` so the TV and a phone can open that branch. Preview addresses are public. Closing the pull request deletes that preview and its Durable Object storage. Previews left by pull requests that are already closed are deleted the same way. Production stays at [friends-quiz.staho.dev](https://friends-quiz.staho.dev).

## Tests

```bash
npm test
npm run check
npm run test:worker
npm run test:e2e
```

- `npm test` runs the unit tests in `test/*.test.ts`: the rules, the wire format, the catalog, the error codes, the strings and the client session code. Tests live in `test/` only.
- `npm run check` applies the catalog migrations bundle and typechecks the client and the Worker.
- `npm run test:worker` starts the real Worker with local Durable Objects and plays rooms over WebSockets (`test/worker/`).
- `npm run test:e2e` builds the client, starts the Worker with it and drives Chrome with `playwright-core` (`test/e2e/`). One test plays a round with a TV and two phones, refreshes the TV, and ends on the podium. The other checks that the TV does not scroll or clip a row for 4, 8, 12 and 20 players at 1920×1080 and 1280×720, on the reveal and on the final board, and that a 320×568 phone fits the reveal. A third checks that answers on the TV, on the question and on the reveal, never break a word, even for 32-character answers and 20-letter words, and that leaving a round takes two taps. Screenshots go to `test-output/`. It takes about a minute. It uses the Chrome at `CHROME_PATH`, `/usr/bin/google-chrome` by default, which GitHub's `ubuntu-latest` runners already have. Nothing is downloaded.

`node scripts/render-icons.mjs` redraws the icons and the link preview image in `client/public/`.
