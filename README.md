# Wordle Helper (fork)

Fork of [vineethtrv/wordle-helper](https://github.com/vineethtrv/wordle-helper) by Vineeth TR, with these changes:

- **Repeated letters work.** Enter each guess and tap its tiles (gray, yellow, green) to match the game. The filter replays Wordle's own scoring, so "exactly one E" (one colored E plus a gray E), "at least two E's" (two colored E's) and "no E in this spot" all come out right.
- Yellow tiles also rule out that position, which the old "Present" box could not express.
- **Every valid word is covered.** The list holds all 14,855 valid guesses in three tiers: the 2,309 classic answers, 1,905 other common words (NYT now picks answers outside the classic list), and the rare rest. All tiers stay in the results, color-coded, so a newer answer never disappears.
- **Best next guess, always on:** after every guess it ranks every valid word by how well it splits the words still standing, weighted so classic answers count most, common words less and rare words a little. Suggestions come in two rows: guesses that could be the answer (with the chance each is right) and narrowing guesses that cannot win but split the rest fastest. It runs in a web worker.
- **Hard mode** toggle: only suggests guesses that keep every green and reuse every revealed letter.
- **Hints only** toggle: hides the word list and keeps the count and best guess, for help without the answer.
- **Correct, Present and Absent boxes** from the original sit at the top for a quick filter without entering whole guesses. They fill in from the guess rows as you color tiles, and letters you type yourself are added on top.
- Color coding: purple for best guesses, blue for likely answers, slate for other valid words, and green, yellow or red counts as the list shrinks.
- Each guess row shows how many likely answers were left after it.
- Tap any suggested word to add it as a guess. Guesses persist in the browser until cleared.
- Fixed result highlighting, which colored a letter green at any position.

Live: https://onionviolet.github.io/wordle-helper/

Run tests: `node test/logic.test.mjs`

Rebuild the word data: `python3 tools/build_data.py WORDS.txt COUNT_1W.txt` (sources are named at the top of the script). After any release, bump every `?v=` in `index.html`, `app.js` and `worker.js` together.
