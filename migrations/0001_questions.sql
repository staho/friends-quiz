CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  FOREIGN KEY (category) REFERENCES categories (id)
);

CREATE TABLE choices (
  question_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  PRIMARY KEY (question_id, position),
  FOREIGN KEY (question_id) REFERENCES questions (id)
);

CREATE INDEX idx_questions_active_category ON questions (active, category, difficulty);
