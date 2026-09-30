# Friends Quiz

A local pub quiz for one TV and a phone per player. The TV shows the question and four answers. Each phone locks in one answer. The server keeps the timer and the scores.

## Run it

```bash
npm install
npm run dev
```

Open the TV at [http://localhost:5173/host](http://localhost:5173/host). The screen shows a room code and a join address. Players on the same Wi-Fi open that address, enter the code and a name, then pick an answer.

`npm run dev` serves the site through Vite on port 5173 and proxies the game socket to the API on port 3000. Phones only need to reach port 5173.

To play from one process instead:

```bash
npm run build
npm start
```

The TV is then [http://localhost:3000/host](http://localhost:3000/host). The server listens on `0.0.0.0` and prints the LAN address. Set `PORT` if 3000 is taken.

Refresh the TV to get back to the same room. Use **New round** after the podium to keep the room code, clear scores, and deal a new set of questions.

## Round

1. Players join the lobby. The host presses **Start** once someone is in.
2. A question stays open for 20 seconds. A player can change the selected answer until they press **Lock in** or the timer ends.
3. The question reveals early when every connected player has locked in.
4. The host presses **Next** when the table is ready. **End** jumps to the podium.
5. A round is 10 questions, shuffled from [`data/questions.json`](data/questions.json).

A correct answer scores 500 points, plus up to 500 more for an instant lock. A correct answer as the timer ends scores 500. A wrong answer or no answer scores 0. The formula is `scoreAnswer` in [`server/game.ts`](server/game.ts).

Add questions to the JSON pack (`prompt`, four `choices`, and `correctIndex` from 0 to 3). Restart the server so it reloads the file.

## Tests

```bash
npm test
```
