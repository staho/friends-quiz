INSERT INTO categories (id, label) VALUES
  ('movies', 'Movies'),
  ('history', 'History'),
  ('common', 'Common knowledge');

UPDATE questions
SET category = 'common'
WHERE category NOT IN ('geography', 'science')
   OR id = 'sunrise';

DELETE FROM categories
WHERE id NOT IN ('science', 'geography', 'movies', 'common', 'history');
