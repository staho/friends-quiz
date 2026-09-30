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
5. A round is 10 questions, shuffled from [`data/questions.json`](data/questions.json).

A correct answer scores 500 points, plus up to 500 more for an instant lock. A correct answer as the timer ends scores 500. A wrong answer or no answer scores 0. The formula is `scoreAnswer` in [`server/game.ts`](server/game.ts).

Add questions to the JSON pack (`prompt`, four `choices`, and `correctIndex` from 0 to 3). Deploy again so the Worker picks up the file.

## Tests

```bash
npm test
```
