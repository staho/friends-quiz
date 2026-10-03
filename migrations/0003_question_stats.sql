CREATE TABLE IF NOT EXISTS question_stats (
  question_id TEXT PRIMARY KEY,
  times_asked INTEGER NOT NULL DEFAULT 0 CHECK (times_asked >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  incorrect_count INTEGER NOT NULL DEFAULT 0 CHECK (incorrect_count >= 0),
  FOREIGN KEY (question_id) REFERENCES questions (id)
);

CREATE TABLE IF NOT EXISTS question_plays (
  play_id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions (id)
);
