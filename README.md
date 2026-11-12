# Wordle Helper (fork)

Fork of [vineethtrv/wordle-helper](https://github.com/vineethtrv/wordle-helper) by Vineeth TR, with these changes:

- **Repeated letters work.** Enter each guess and tap its tiles (gray, yellow, green) to match the game. The filter replays Wordle's own scoring, so "exactly one E" (one colored E plus a gray E), "at least two E's" (two colored E's) and "no E in this spot" all come out right.
- Yellow tiles also rule out that position, which the old "Present" box could not express.
- Likely answers (the original answer list) are listed before other valid words, each sorted by common letters, with a live count.
- **Best next guess:** once 250 or fewer likely answers remain, it ranks every valid word by how evenly it splits them (expected words left).
- **Paste your share grid** (normal or high-contrast squares). The colors fill in, and you type each row's word. Lines like `CRANE 🟩⬛🟨⬛⬛` fill in the word too.
- Tap any suggested word to add it as a guess. Guesses persist in the browser until cleared.
- Fixed result highlighting, which colored a letter green at any position.

Live: https://onionviolet.github.io/wordle-helper/

Run tests: `node test/logic.test.mjs`
