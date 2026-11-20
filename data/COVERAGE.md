# Question coverage

Polish bank. Each category × difficulty cell holds 10 active questions (about half Poland or Central Europe, half world): 250 in all. The 112 English questions from migrations 0002–0009 are retired with `active = 0` in `0010_polish_switch.sql` and are never deleted, because `question_stats` and `question_plays` reference them.

## Difficulty

Calibrated for a table of Polish adults aged 25–50 with mixed education. The percentage is the share who know the answer, not the share who guess it. Difficulty comes from what is asked and from how close the wrong answers are.

| Level | Name | Who knows it | Wrong answers |
| --- | --- | --- | --- |
| 1 | Rozgrzewka | 90% or more | Same type, but obviously wrong to anyone who knows the topic |
| 2 | Łatwe | 70–90% | One plausible rival |
| 3 | Średnie | 40–70% | Two plausible rivals |
| 4 | Trudne | 20–40% | All three plausible, including a trap |
| 5 | Ekspert | 5–20% | Near misses from the same set |

A question belongs to the lowest level where it fits. Level 1 asks nothing that must be recalled exactly. Levels 1–2 have no year and no negative ("NIE") questions. A round of 10 takes two questions from each level, in order from 1 to 5, and categories stay mixed.

## Rules for new questions

- Natural Polish with full diacritics (NFC), titles in „…”, Polish exonyms and Polish film titles. One question per prompt, ending in `?`.
- Prompt up to 110 characters (aim for 90). Each answer up to 32 characters (aim for 24). Four distinct answers of the same kind and similar length.
- Exactly one defensible answer. No joke answers, no "wszystkie powyższe". The prompt must not contain the answer.
- No dating words (obecnie, aktualnie, teraz, dziś, najnowsz-, w tym roku), no office holders, no changeable records, nothing after 2020, no contested facts.
- Ids are `pl-<category>-<slug>`, at most 48 characters, with no level inside, so a later re-levelling does not leave a misleading id.
- No question may give away another. Each recurring topic has one owning category: music, literature, sport and Polish language in Wiedza ogólna; science figures and animals in Nauka i przyroda; Polish film people in Film i seriale; Polish and world events in Historia; places in Geografia.
- Per cell: at most 1 negative question, at most 3 numeric answers, at most 3 questions on one sub-topic.
- The catalog tests enforce the format rules, 8 to 10 questions per cell, and the Polish labels.

## Geografia

- Level 1: 10
- Level 2: 10
- Level 3: 10
- Level 4: 10
- Level 5: 10

## Nauka i przyroda

- Level 1: 10
- Level 2: 10
- Level 3: 10
- Level 4: 10
- Level 5: 10

## Wiedza ogólna

- Level 1: 10
- Level 2: 10
- Level 3: 10
- Level 4: 10
- Level 5: 10

## Film i seriale

- Level 1: 10
- Level 2: 10
- Level 3: 10
- Level 4: 10
- Level 5: 10

## Historia

- Level 1: 10
- Level 2: 10
- Level 3: 10
- Level 4: 10
- Level 5: 10

## Still missing

Nothing. To grow a cell, add a new migration file. Never edit an applied migration (0001–0015).
