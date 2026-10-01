# Friends Quiz

A local pub quiz for one TV and a phone per player. The TV shows the question and four answers. Each phone locks in one answer. The server keeps the timer and the scores.

## Run it

```bash
npm install
npm run dev
```

Open the TV at [http://localhost:8787/host](http://localhost:8787/host). The screen shows a room code and a join address. Players open that address, enter the code and a name, then pick an answer.

`npm run dev` builds the site and serves it with Wrangler. On your own Wi-Fi, open the network address Wrangler prints so phones can reach the TV's URL.

Refresh the TV to get back to the same room. Use **New round** after the podium to keep the room code, clear scores, and deal a new set of questions.

Pushes to `main` deploy the Worker to [friends-quiz.staho.dev](https://friends-quiz.staho.dev). Pull requests run the tests.

## Round

1. Players join the lobby. The host presses **Start** once someone is in.
2. A question stays open for 20 seconds. A player can change the selected answer until they press **Lock in** or the timer ends.
3. The question reveals early when every connected player has locked in.
4. The host presses **Next** when the table is ready. **End** jumps to the podium.
5. A round is 10 questions. The next one is chosen when the host starts or presses **Next**, from the questions still unused in that room.

A correct answer scores 500 points, plus up to 500 more for an instant lock. A correct answer as the timer ends scores 500. A wrong answer or no answer scores 0. The formula is `scoreAnswer` in [`server/game.ts`](server/game.ts). Each answer is kept on the room, with the question category and difficulty, so a later picker can use how the table is doing.

Questions live in the D1 database `friends-quiz`. The schema and the starting pack are [`migrations/0001_questions.sql`](migrations/0001_questions.sql) and [`migrations/0002_seed.sql`](migrations/0002_seed.sql). `npm run dev` applies those migrations to the local database. A deploy creates the remote database if it is missing, applies the migrations, then publishes the Worker. Add a new migration to change the bank.

## Tests

```bash
npm test
```
