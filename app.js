import { COLLECTION } from './data.js';
import { GRAY, GREEN, filterCandidates, knowledge, rankByFrequency, bestGuesses, hardLegal, quickFilter } from './logic.js?v=5';

// data.js holds the original 2,309 answer words first, then the extra
// allowed guesses. NYT has edited answers since 2022, so the extras still
// show, just below the likely answers.
const ANSWER_COUNT = 2309;
const ALL = [...new Set(COLLECTION)];
const ANSWERS = new Set(ALL.slice(0, ANSWER_COUNT));
const VALID = new Set(ALL);
const SHOW_MAX = 500;
const BEST_MAX_INLINE = 250; // main-thread fallback limit when workers are unavailable
const STORE_KEY = 'wordle-helper-rows-v1';
const OPTS_KEY = 'wordle-helper-opts-v1';

const FIRST_ENTRY = ['salet', 'crane', 'slate', 'trace', 'crate', 'raise', 'stare', 'arose', 'audio', 'roate'];

const $ = id => document.getElementById(id);
const input = $('guess-input');
const COLOR_CLASS = ['gray', 'yellow', 'green'];

let rows = load();
let opts = loadOpts();
let bestTimer = null, worker = null, workerBusy = false, jobId = 0;
const played = () => rows.filter(r => r.word);

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (Array.isArray(saved)) return saved.filter(r => /^[a-z]{5}$/.test(r.word || '') && r.colors?.length === 5);
    } catch (_) { /* storage blocked */ }
    return [];
}
function loadOpts() {
    try { const o = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}'); const letters = v => (typeof v === 'string' ? v : '').toLowerCase().replace(/[^a-z]/g, ''); return { hard: !!o.hard, hide: !!o.hide, present: letters(o.present).slice(0, 5), absent: letters(o.absent), correct: [0, 1, 2, 3, 4].map(i => letters(o.correct?.[i]).slice(0, 1)) }; } catch (_) { return { hard: false, hide: false, present: '', absent: '', correct: ['', '', '', '', ''] }; }
}
function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)); localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch (_) { /* ignore */ }
}

// Everything known so far: the guess rows plus the Present letter box.
function known() {
    const k = knowledge(played());
    const need = {};
    for (const c of opts.present) need[c] = (need[c] || 0) + 1;
    for (const c in need) { k.present.add(c); k.min[c] = Math.max(k.min[c] || 0, need[c]); }
    const fixed = {};
    opts.correct.forEach((c, i) => { if (c) { k.green[i] = c; k.present.add(c); fixed[c] = (fixed[c] || 0) + 1; } });
    for (const c in fixed) k.min[c] = Math.max(k.min[c] || 0, fixed[c]);
    return k;
}
const hasClues = () => played().length || opts.present || opts.absent || opts.correct.some(Boolean);

// Pre-color a new guess with anything already proven, so the player
// usually only has to tap the new information.
function guessColors(word) {
    const k = known();
    return word.split('').map((c, i) => (k.green[i] === c ? GREEN : GRAY));
}

function addGuess(raw) {
    const word = (raw || '').toLowerCase().replace(/[^a-z]/g, '');
    const msg = $('guess-msg');
    if (word.length !== 5) { msg.textContent = 'A guess needs exactly 5 letters.'; return; }
    if (rows.length >= 6) { msg.textContent = 'Wordle allows six guesses. Remove one first.'; return; }
    msg.textContent = VALID.has(word) ? '' : `"${word.toUpperCase()}" is not in the word list, but it was added.`;
    rows.push({ word, colors: guessColors(word) });
    input.value = '';
    update();
}

// How many likely answers were still possible after each guess, so the
// player can see how much every guess narrowed things down.
function leftAfterEach() {
    let cur = ALL.filter(w => ANSWERS.has(w)), any = ALL, out = [];
    for (const r of rows) {
        if (!r.word) { out.push(null); continue; }
        cur = filterCandidates(cur, [r]); any = filterCandidates(any, [r]);
        out.push(cur.length || any.length);
    }
    return out;
}

function renderRows() {
    const left = leftAfterEach();
    $('rows').innerHTML = rows.map((r, ri) => `
        <div class="row">
            ${r.colors.map((col, i) => { const c = r.word ? r.word[i] : ''; return `<button type="button" class="tile ${COLOR_CLASS[col]}" data-r="${ri}" data-i="${i}" aria-label="${c || 'blank'} ${COLOR_CLASS[col]}">${c}</button>`; }).join('')}
            <span class="left ${left[ri] <= 10 ? 'few' : left[ri] <= 100 ? 'some' : 'many'}">${left[ri].toLocaleString()} left</span>
            <button type="button" class="remove" data-r="${ri}" aria-label="Remove guess">×</button>
        </div>`).join('');
}

function renderKnown() {
    const k = knowledge(played());
    const bits = [];
    for (const c of Object.keys(k.min).sort()) {
        if (k.exact[c] !== undefined) bits.push(`exactly ${k.exact[c]} ${c.toUpperCase()}`);
        else if (k.min[c] > 1) bits.push(`at least ${k.min[c]} ${c.toUpperCase()}`);
    }
    const absent = Object.keys(k.exact).filter(c => k.exact[c] === 0).sort();
    if (absent.length) bits.push(`no ${absent.join(' ').toUpperCase()}`);
    $('known').textContent = bits.length ? `Known: ${bits.join(', ')}.` : '';
}

function wordHtml(w, k) {
    const letters = w.split('').map((c, i) => {
        const cls = k.green[i] === c ? 'crtSty' : k.present.has(c) ? 'incSty' : '';
        return `<i class="${cls}">${c}</i>`;
    }).join('');
    return `<button type="button" class="word" data-w="${w}" title="Add ${w.toUpperCase()} as a guess">${letters}</button>`;
}

function renderResults() {
    const k = known();
    cancelBest();
    $('best').innerHTML = '';

    if (!hasClues()) {
        $('summary').innerHTML = `<h2 class="h-best">Strong first guesses</h2><p>${ALL.length.toLocaleString()} words in the list, ${ANSWER_COUNT.toLocaleString()} of them past or likely answers.</p>`;
        $('results').innerHTML = `<div class="group best">${FIRST_ENTRY.map(w => wordHtml(w, k)).join('')}</div>`;
        return;
    }

    const cands = quickFilter(filterCandidates(ALL, played()), opts.present, opts.absent, knowledge(played()).present, opts.correct);
    const likely = rankByFrequency(cands.filter(w => ANSWERS.has(w)));
    const other = rankByFrequency(cands.filter(w => !ANSWERS.has(w)));

    if (!cands.length) {
        $('summary').innerHTML = '<h2>No words match</h2><p>Check the tile colors. A gray tile next to a yellow or green of the same letter means "no more copies of that letter".</p>';
        $('results').innerHTML = '';
        return;
    }

    $('summary').innerHTML = `<h2><b class="count ${cands.length <= 10 ? 'few' : cands.length <= 100 ? 'some' : 'many'}">${cands.length.toLocaleString()}</b> possible word${cands.length === 1 ? '' : 's'}</h2>
        <p><b class="c-likely">${likely.length}</b> from the answer list, <b class="c-other">${other.length}</b> other valid words. Sorted by common letters.</p>`;

    let html = '';
    if (opts.hide) html = '<p class="msg">Word list hidden. Untick "Hints only" to see it.</p>';
    else {
        if (likely.length) html += `<h3 class="h-likely">Likely answers</h3><div class="group likely">${likely.slice(0, SHOW_MAX).map(w => wordHtml(w, k)).join('')}</div>`;
        if (other.length) {
            const room = Math.max(SHOW_MAX - likely.length, 60);
            html += `<h3 class="h-other">Other valid words</h3><div class="group other">${other.slice(0, room).map(w => wordHtml(w, k)).join('')}</div>`;
            if (other.length > room) html += `<p class="msg">${other.length - room} more not shown.</p>`;
        }
    }
    $('results').innerHTML = html;

    // Best next guess: entropy over the likely answers (or everything left).
    const targets = likely.length ? likely : other;
    if (targets.length > 2 && played().length < 6) requestBest(targets, k);
}

function cancelBest() {
    jobId++;
    clearTimeout(bestTimer);
    if (worker && workerBusy) { worker.terminate(); worker = null; workerBusy = false; }
}

// Ranks every valid word (or every hard-mode-legal word) in a worker.
function requestBest(targets, k) {
    const id = jobId;
    const pool = opts.hard ? ALL.filter(w => hardLegal(w, k)) : null;
    const show = best => {
        if (id !== jobId) return;
        $('best').innerHTML = `<h3 class="h-best">Best next guess <span>(${opts.hard ? 'hard mode, ' : ''}splits the ${targets.length.toLocaleString()} likely words most evenly)</span></h3>
            <div class="group best">${best.map(b => `<span class="best-item">${wordHtml(b.word, k)}<small>${b.isCandidate ? '<em>could win</em> · ' : ''}~${b.expLeft.toFixed(1)} left</small></span>`).join('')}</div>`;
    };
    const inline = () => {
        workerBusy = false; worker = null;
        if (id !== jobId) return;
        if (targets.length > BEST_MAX_INLINE) { $('best').innerHTML = ''; return; }
        bestTimer = setTimeout(() => show(bestGuesses(pool || ALL, targets, 5)), 30);
    };
    $('best').innerHTML = '<p class="msg">Working out the best next guess...</p>';
    try {
        if (!worker) worker = new Worker('./worker.js?v=5', { type: 'module' });
        workerBusy = true;
        worker.onmessage = e => {
            if (e.data.id !== id || id !== jobId) return;
            if (e.data.best) { workerBusy = false; show(e.data.best); }
            else $('best').innerHTML = `<p class="msg">Working out the best next guess... ${Math.round(e.data.progress * 100)}%</p>`;
        };
        worker.onerror = e => { e.preventDefault(); inline(); };
        worker.postMessage({ id, targets, pool, top: 5 });
    } catch (_) { inline(); }
}

function update() {
    save();
    renderRows();
    renderKnown();
    renderResults();
}

input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGuess(input.value); } });
input.addEventListener('input', () => { input.value = input.value.replace(/[^a-zA-Z]/g, '').slice(0, 5); });
$('add-guess').addEventListener('click', () => addGuess(input.value));
for (const key of ['present', 'absent']) {
    const box = $('input-' + key);
    box.value = opts[key];
    box.addEventListener('input', () => {
        const clean = box.value.replace(/[^a-zA-Z]/g, '').slice(0, key === 'present' ? 5 : 26);
        if (clean !== box.value) box.value = clean;
        opts[key] = clean.toLowerCase();
        update();
    });
}

const correctBoxes = [...document.querySelectorAll('#form-correct input')];
correctBoxes.forEach((box, i) => {
    box.value = opts.correct[i];
    box.addEventListener('input', () => {
        const c = box.value.replace(/[^a-zA-Z]/g, '').slice(-1);
        box.value = c;
        opts.correct[i] = c.toLowerCase();
        if (c && correctBoxes[i + 1]) correctBoxes[i + 1].focus();
        update();
    });
    box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) correctBoxes[i - 1].focus();
    });
    box.addEventListener('focus', () => box.select());
});

$('clear').addEventListener('click', () => {
    rows = []; opts.present = opts.absent = ''; opts.correct = ['', '', '', '', ''];
    $('input-present').value = $('input-absent').value = '';
    correctBoxes.forEach(b => { b.value = ''; });
    $('guess-msg').textContent = ''; update();
});

$('rows').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const r = +t.dataset.r;
    if (t.classList.contains('remove')) rows.splice(r, 1);
    else { const i = +t.dataset.i; rows[r].colors[i] = (rows[r].colors[i] + 1) % 3; }
    update();
});

$('side').addEventListener('click', e => {
    const w = e.target.closest('.word');
    if (w) addGuess(w.dataset.w);
});

update();
