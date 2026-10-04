# Friends Quiz

A pub quiz for one TV and a phone per player. The TV shows the question and four answers. Each phone locks in one answer. A Cloudflare Worker keeps the timer, the scores, and the question bank.

## How it plays

1. Players join the lobby. The host presses **Start** once someone is in.
2. A question stays open for 20 seconds. A player can change the selected answer until they press **Lock in** or the timer ends.
3. The question reveals early when every connected player has locked in.
4. The next question starts 8 seconds after the answer. The host can change that wait, turn it off, or pause it. **Pause** or the space bar holds the countdown. **Next** skips the wait. **End** jumps to the podium.
5. A round is 10 questions, two from each difficulty level, played from warm-up to expert. The next one is chosen when the host starts or the countdown ends, from unused questions at that level.

A correct answer scores 500 points, plus up to 500 more for an instant lock. A correct answer as the timer ends scores 500. A wrong answer or no answer scores 0. The formula is `scoreAnswer` in [`server/game.ts`](server/game.ts). Each answer is kept on the room, with the question category and difficulty, so a later picker can use how the table is doing.

Refresh the TV to get back to the same room. **New round** keeps the room code, clears scores, and deals a new set of questions.

## Architecture

- **Client.** React screens in [`client/src/screens/`](client/src/screens/). Vite builds them into `client/dist`. The Worker serves that folder as static assets.
- **Worker.** [`worker/index.ts`](worker/index.ts) opens rooms and routes sockets. `POST /api/rooms` creates a room. `/ws/:code` is the game socket. Every other path is the site.
- **Room.** One `RoomDurableObject` per room code. It runs the rules in [`server/game.ts`](server/game.ts), holds the live WebSockets, and sets an alarm for the question timer and the pause before the next question.
- **Catalog.** One `CatalogDurableObject` holds the question bank and picks the next unused question at the current difficulty.

## Dependencies

React 19, Vite, TypeScript, and Wrangler. Node 22 runs the tests.

## Data

SQLite lives inside the Durable Objects.

The catalog object creates these tables on first start from [`migrations/0001_questions.sql`](migrations/0001_questions.sql), then loads [`migrations/0002_seed.sql`](migrations/0002_seed.sql). Later migration files add categories and questions. The object applies each file once.

| Table | Stores |
| --- | --- |
| `categories` | id, label |
| `questions` | prompt, category, difficulty (1–5), active |
| `choices` | four answers per question, one marked correct |

[`data/COVERAGE.md`](data/COVERAGE.md) records how full each category and difficulty level is.

The room object keeps a single `room` row (`id` = 1, `data` = the live game as JSON): phase, players, scores, and answers. Both objects keep that data across deploys.

## Connections

Each browser opens one WebSocket to `/ws/CODE`. The server pushes `state`. The client sends the events in [`shared/wire.ts`](shared/wire.ts):

- Host: `host:attach`, `host:start`, `host:next`, `host:pause`, `host:end`, `host:reset`
- Player: `player:join`, `player:attach`, `player:choose`, `player:lock`

The TV creates the room with `POST /api/rooms` and stores the host token in `sessionStorage`. Phones store the player token the same way, so a refresh reattaches.

## Deployment

```bash
npm install
npm run dev
```

`npm run dev` builds the client and starts Wrangler. Open the TV at [http://localhost:8787/host](http://localhost:8787/host). On your own Wi-Fi, use the network address Wrangler prints so phones can join.

`npm run deploy` publishes the Worker. A push to `main` runs the tests and the typecheck, then deploys through GitHub Actions, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, to [friends-quiz.staho.dev](https://friends-quiz.staho.dev). A pull request deploys a separate Workers preview so the TV and a phone can open that branch. Preview addresses are public.

## Tests

```bash
npm test
```
