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
- **Live filtering.** Every marked tile immediately updates the candidates, including on the first guess. Unmarked tiles leave the color open. Use **Rest gray** to mark the remaining tiles gray. The best-guess search waits for a short pause in tapping.
- **Clue checks.** If no words fit, the helper highlights a tile and suggests a different color when a single change would bring candidates back.
- **Late-game suggestions.** With two turns left, guesses are ranked by their weighted chance of isolating a single answer. The last turn suggests possible answers.
- **Typed colors:** `crane 02100` (0 gray, 1 yellow, 2 green) or `crane bybgg` adds a guess with its colors in one step.
- **On-screen keyboard** shows which letters are green, yellow, gray or untried, and types into the guess box.
- **Phone layout:** the count and top picks appear right under your guesses; the Correct, Present and Absent boxes fold into a Quick filter section.
- Suggestions show how many color groups each guess splits the words into, and a solved game offers a copyable emoji grid.
- Past answers stay in the list on purpose: NYT has reused them since February 2026.
- Fixed result highlighting, which colored a letter green at any position.

Live: https://onionviolet.github.io/wordle-helper/

Run tests: `node test/logic.test.mjs`

Rebuild the word data: `python3 tools/build_data.py WORDS.txt COUNT_1W.txt` (sources are named at the top of the script). After any release, bump every `?v=` in `index.html`, `app.js` and `worker.js` together.
