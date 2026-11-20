UPDATE categories SET label = 'Geografia' WHERE id = 'geography';
UPDATE categories SET label = 'Nauka i przyroda' WHERE id = 'science';
UPDATE categories SET label = 'Wiedza ogólna' WHERE id = 'common';
UPDATE categories SET label = 'Film i seriale' WHERE id = 'movies';
UPDATE categories SET label = 'Historia' WHERE id = 'history';
UPDATE questions SET active = 0 WHERE substr(id, 1, 3) <> 'pl-';
