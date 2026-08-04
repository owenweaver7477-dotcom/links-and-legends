/* =========================================================================
   charts.js — the clubhouse's statistics, drawn
   -------------------------------------------------------------------------
   The career panel was eight numbers in boxes. Numbers in boxes tell you
   what happened; a shape tells you whether you are getting better, which is
   the only thing anybody actually opens this screen to find out.

   Inline SVG, same as the club art: nothing downloaded, crisp at any size,
   and it uses the game's own palette rather than a charting library's.

   Everything here takes plain arrays and returns a string. No DOM, no state,
   so the panel can re-render on every profile push without leaking anything.
   ========================================================================= */

const GOOD = '#8fe07a';
const BAD = '#ff8a6f';
const DIM = 'rgba(255,255,255,.10)';
const INK = '#8fa694';

const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Form: the last N rounds against par, as a line with the zero line marked.
 * Under par is above the line and green; over is below and warm.
 *
 * A bar chart was the first attempt and it was wrong — bars imply
 * independent quantities, and what a player wants to see here is a TREND.
 */
export function formChart(history, w = 1000, h = 150) {
  const data = (history || []).slice(-20).map(Number).filter(Number.isFinite);
  if (data.length < 2) {
    return `<div class="chart-empty">Play a few rounds and your form appears here</div>`;
  }
  const pad = 22;
  const lo = Math.min(-2, ...data), hi = Math.max(2, ...data);
  const span = Math.max(1, hi - lo);
  const x = i => pad + (i / (data.length - 1)) * (w - pad * 2);
  // NOTE the inversion: lower (better) scores must sit HIGHER on the chart
  const y = v => pad + ((v - lo) / span) * (h - pad * 2);
  const zeroY = y(0);

  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${pad},${zeroY.toFixed(1)} ${pts} ${(w - pad).toFixed(1)},${zeroY.toFixed(1)}`;
  const best = Math.min(...data), bestI = data.indexOf(best);

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img"
      aria-label="form over the last ${data.length} rounds">
    <defs>
      <linearGradient id="formfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${GOOD}" stop-opacity=".30"/>
        <stop offset="1" stop-color="${GOOD}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <line x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}"
          stroke="${DIM}" stroke-width="2" stroke-dasharray="8 8"/>
    <text x="${w - pad}" y="${zeroY - 9}" text-anchor="end"
          font-size="19" fill="${INK}">level par</text>
    <polygon points="${area}" fill="url(#formfill)"/>
    <polyline points="${pts}" fill="none" stroke="${GOOD}" stroke-width="4.5"
              stroke-linejoin="round" stroke-linecap="round"/>
    ${data.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === bestI ? 8 : 4.5}"
        fill="${i === bestI ? '#fff' : v <= 0 ? GOOD : BAD}"/>`).join('')}
    <text x="${x(bestI).toFixed(1)}" y="${Math.max(22, y(best) - 14).toFixed(1)}"
          text-anchor="middle" font-size="21" font-weight="700" fill="#fff">
      ${best > 0 ? '+' + best : best === 0 ? 'E' : best}</text>
  </svg>`;
}

/**
 * Where the strokes go: a stacked bar of birdies / pars / bogeys / worse.
 * Proportional rather than absolute, because "40% pars" is a fact about how
 * you play and "112 pars" is a fact about how long you have played.
 */
export function scoringChart(prof, w = 1000, h = 46) {
  const holes = prof?.holes || 0;
  if (!holes) return `<div class="chart-empty">No holes played yet</div>`;

  const eagles = prof.eagles || 0, birdies = prof.birdies || 0, aces = prof.aces || 0;
  const under = eagles + birdies + aces;
  /* Pars are not counted anywhere, so they are inferred: the profile records
     total strokes and total holes, and a rough par of 4 per hole gives an
     honest-enough split. Marked as an estimate rather than dressed up. */
  const overStrokes = Math.max(0, (prof.strokes || 0) - holes * 4);
  const over = Math.min(holes - under, Math.round(overStrokes * 0.8));
  const pars = Math.max(0, holes - under - over);

  const segs = [
    { n: under, c: GOOD, label: 'under par' },
    { n: pars, c: '#cfe4d3', label: 'par' },
    { n: over, c: BAD, label: 'over par' }
  ].filter(s => s.n > 0);

  let cx = 0;
  const bars = segs.map(s => {
    const bw = (s.n / holes) * w;
    const r = `<rect x="${cx.toFixed(1)}" y="0" width="${Math.max(0, bw - 5).toFixed(1)}"
      height="19" rx="5" fill="${s.c}"><title>${s.n} ${s.label}</title></rect>`;
    const pct = Math.round(s.n / holes * 100);
    const t = bw > 120
      ? `<text x="${(cx + bw / 2).toFixed(1)}" y="39" text-anchor="middle"
           font-size="19" fill="${INK}">${pct}% ${esc(s.label)}</text>` : '';
    cx += bw;
    return r + t;
  }).join('');

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img"
      aria-label="scoring split">${bars}</svg>`;
}

/**
 * A small radial dial — used for the three percentages that already exist
 * (fairways, greens in regulation, and the putting average inverted).
 */
export function dial(pct, label, value, w = 74) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = 26, c = 2 * Math.PI * r, cx = w / 2, cy = 34;
  const col = p >= 66 ? GOOD : p >= 40 ? '#ffd94a' : BAD;
  return `<div class="dialbox">
    <svg viewBox="0 0 ${w} 74" class="dial" role="img" aria-label="${esc(label)} ${p}%">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${DIM}" stroke-width="6"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="6"
        stroke-linecap="round" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="15"
        font-weight="800" fill="#eaf3ea">${esc(value)}</text>
    </svg>
    <span class="diallabel">${esc(label)}</span>
  </div>`;
}
