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
// over the remaining candidates). Cost is |pool| x |targets|, so the inner
// loop works on letter codes and allocates nothing. `onProgress` gets a
// 0..1 fraction now and then (used by the worker).
const POW3 = [1, 3, 9, 27, 81];
export function bestGuesses(pool, targets, top = 5, onProgress) {
    const n = targets.length;
    const targetSet = new Set(targets);
    const T = new Uint8Array(n * 5);
    for (let t = 0; t < n; t++) for (let i = 0; i < 5; i++) T[t * 5 + i] = targets[t].charCodeAt(i) - 97;
    const counts = new Uint16Array(243);
    const left = new Int8Array(26);
    const g = new Uint8Array(5);
    const results = [];
    for (let pi = 0; pi < pool.length; pi++) {
        const word = pool[pi];
        for (let i = 0; i < 5; i++) g[i] = word.charCodeAt(i) - 97;
        counts.fill(0);
        for (let o = 0; o < n * 5; o += 5) {
            let code = 0;
            for (let i = 0; i < 5; i++) {
                const a = T[o + i];
                if (g[i] === a) code += 2 * POW3[i]; else left[a]++;
            }
            for (let i = 0; i < 5; i++) {
                const c = g[i];
                if (c !== T[o + i] && left[c] > 0) { code += POW3[i]; left[c]--; }
            }
            for (let i = 0; i < 5; i++) left[T[o + i]] = 0;
            counts[code]++;
        }
        let h = 0, expLeft = 0;
        for (let k = 0; k < 243; k++) {
            const c = counts[k];
            if (!c) continue;
            const p = c / n;
            h -= p * Math.log2(p);
            expLeft += c * p;
        }
        // A candidate guess can win outright; give it a small edge on ties.
        const isCandidate = targetSet.has(word);
        results.push({ word, bits: h, expLeft, isCandidate, key: h + (isCandidate ? 1 / n : 0) });
        if (onProgress && pi % 1000 === 999) onProgress(pi / pool.length);
    }
    results.sort((a, b) => b.key - a.key);
    return results.slice(0, top);
}

// Wordle hard mode: a guess must keep every green in place and reuse every
// revealed letter (as many copies as have been lit at once).
export function hardLegal(word, k) {
    for (let i = 0; i < 5; i++) if (k.green[i] && word[i] !== k.green[i]) return false;
    for (const c in k.min) if (word.split(c).length - 1 < k.min[c]) return false;
    return true;
}

// Quick letter boxes, for filtering without entering a whole guess.
// `present`: letters the word must contain (typing a letter twice asks for
// two copies). `absent`: letters the word must not contain; a letter that
// is also known to be in the word is ignored there rather than trusted.
export function quickFilter(words, present, absent, lit = new Set()) {
    const need = {};
    for (const c of present) need[c] = (need[c] || 0) + 1;
    const banned = [...new Set(absent)].filter(c => !need[c] && !lit.has(c));
    if (!banned.length && !present.length) return words;
    return words.filter(w => {
        for (const c of banned) if (w.includes(c)) return false;
        for (const c in need) if (w.split(c).length - 1 < need[c]) return false;
        return true;
    });
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
