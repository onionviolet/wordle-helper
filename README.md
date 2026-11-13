# Wordle Helper (fork)

Fork of [vineethtrv/wordle-helper](https://github.com/vineethtrv/wordle-helper) by Vineeth TR, with these changes:

- **Repeated letters work.** Enter each guess and tap its tiles (gray, yellow, green) to match the game. The filter replays Wordle's own scoring, so "exactly one E" (one colored E plus a gray E), "at least two E's" (two colored E's) and "no E in this spot" all come out right.
- Yellow tiles also rule out that position, which the old "Present" box could not express.
- Likely answers (the original answer list) are listed before other valid words, each sorted by common letters, with a live count.
- **Best next guess, always on:** after every guess it ranks every valid word by how evenly it splits the likely answers (expected words left). It runs in a web worker, so it works with the whole answer list still in play.
- **Hard mode** toggle: only suggests guesses that keep every green and reuse every revealed letter.
- **Hints only** toggle: hides the word list and keeps the count and best guess, for help without the answer.
- **Correct, Present and Absent boxes** from the original sit at the top for a quick filter without entering whole guesses. They fill in from the guess rows as you color tiles, and letters you type yourself are added on top.
- Color coding: purple for best guesses, blue for likely answers, slate for other valid words, and green, yellow or red counts as the list shrinks.
- Each guess row shows how many likely answers were left after it.
- Tap any suggested word to add it as a guess. Guesses persist in the browser until cleared.
- Fixed result highlighting, which colored a letter green at any position.

Live: https://onionviolet.github.io/wordle-helper/

Run tests: `node test/logic.test.mjs`
