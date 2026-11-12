// Pure Wordle logic, shared by the page and the Node tests.
// Colors: 0 = gray (absent), 1 = yellow (present), 2 = green (correct).

export const GRAY = 0, YELLOW = 1, GREEN = 2;

// Score `guess` against `answer` exactly like Wordle does, so repeated
// letters behave correctly: greens first, then yellows left to right while
// unused copies of that letter remain in the answer.
export function score(guess, answer) {
    const out = [GRAY, GRAY, GRAY, GRAY, GRAY];
    const left = {};
    for (let i = 0; i < 5; i++) {
        if (guess[i] === answer[i]) out[i] = GREEN;
        else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
        if (out[i] === GREEN) continue;
        const c = guess[i];
        if (left[c] > 0) { out[i] = YELLOW; left[c]--; }
    }
    return out;
}

// Same as score() but packed into one base-3 number (0..242) for speed.
export function scoreCode(guess, answer) {
    const s = score(guess, answer);
    return s[0] + 3 * s[1] + 9 * s[2] + 27 * s[3] + 81 * s[4];
}

const sameColors = (a, b) => a.every((v, i) => v === b[i]);

// A word stays a candidate only if every past guess would have produced
// exactly the colors the player saw.
export function filterCandidates(words, rows) {
    if (!rows.length) return words.slice();
    return words.filter(w => rows.every(r => sameColors(score(r.word, w), r.colors)));
}

// What the rows prove, for highlighting and the summary line.
export function knowledge(rows) {
    const green = [null, null, null, null, null];
    const present = new Set();
    const min = {}, exact = {};
    for (const { word, colors } of rows) {
        const lit = {}, grayed = {};
        for (let i = 0; i < 5; i++) {
            const c = word[i];
            if (colors[i] === GREEN) green[i] = c;
            if (colors[i] !== GRAY) { lit[c] = (lit[c] || 0) + 1; present.add(c); }
            else grayed[c] = true;
        }
        for (const c in lit) min[c] = Math.max(min[c] || 0, lit[c]);
        for (const c in grayed) exact[c] = lit[c] || 0;
    }
    return { green, present, min, exact };
}

// Rank by how common each word's distinct letters are among the candidates.
export function rankByFrequency(words) {
    const freq = {};
    for (const w of words) for (const c of new Set(w)) freq[c] = (freq[c] || 0) + 1;
    const val = w => [...new Set(w)].reduce((s, c) => s + freq[c], 0);
    return words.map(w => [w, val(w)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

// Best next guesses by expected information (entropy of the color pattern
// over the remaining candidates). Cost is |pool| x |targets|, so callers
// should keep targets small.
export function bestGuesses(pool, targets, top = 5) {
    const n = targets.length;
    const targetSet = new Set(targets);
    const counts = new Uint16Array(243);
    const results = [];
    for (const g of pool) {
        counts.fill(0);
        for (const t of targets) counts[scoreCode(g, t)]++;
        let h = 0, expLeft = 0;
        for (let k = 0; k < 243; k++) {
            const c = counts[k];
            if (!c) continue;
            const p = c / n;
            h -= p * Math.log2(p);
            expLeft += c * p;
        }
        // A candidate guess can win outright; give it a small edge on ties.
        const bonus = targetSet.has(g) ? 1 / n : 0;
        results.push({ word: g, bits: h, expLeft, isCandidate: targetSet.has(g), key: h + bonus });
    }
    results.sort((a, b) => b.key - a.key);
    return results.slice(0, top);
}

// Parse a pasted Wordle share block. Each line with five color squares
// becomes one row. A 5-letter word on the same line (e.g. "CRANE 🟩⬛🟨⬛⬛")
// is kept; otherwise word is null and the player types it later.
// Supports normal (green/yellow) and high-contrast (orange/blue) squares.
const SQUARE = { '🟩': GREEN, '🟧': GREEN, '🟨': YELLOW, '🟦': YELLOW, '⬛': GRAY, '⬜': GRAY };
export function parseShare(text) {
    const out = [];
    for (const line of String(text).split(/\r?\n/)) {
        const colors = Array.from(line).filter(ch => ch in SQUARE).map(ch => SQUARE[ch]);
        if (colors.length !== 5) continue;
        const m = line.match(/\b[a-zA-Z]{5}\b/);
        out.push({ word: m ? m[0].toLowerCase() : null, colors });
    }
    return out;
}
