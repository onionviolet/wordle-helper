// Runs the best-next-guess search off the main thread so the page stays
// responsive even with the full answer list still in play.
import { COLLECTION } from './data.js';
import { bestGuesses } from './logic.js?v=6';

const ALL = [...new Set(COLLECTION)];

onmessage = e => {
    const { id, targets, pool, top } = e.data;
    const best = bestGuesses(pool || ALL, targets, top, f => postMessage({ id, progress: f }));
    postMessage({ id, best });
};
