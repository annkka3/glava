// The Piper voices read a question almost like a statement: the question mark reaches the model, but
// the pitch still falls at the end. Here the last syllable of a yes/no question is lifted after
// synthesis, so the phrase ends on a rising tone and is heard as a question.
// The pitch is changed with pitch-synchronous overlap-add: the sound is cut into single voice periods
// and they are laid down closer together, which raises the tone without changing the timbre or tempo.
// Questions that open with a question word (кто, где, почему…) keep their natural falling tone.

const WH = new Set(['кто', 'кого', 'кому', 'кем', 'ком', 'что', 'чего', 'чему', 'чем', 'чей', 'чья', 'чье', 'чьи',
  'какой', 'какая', 'какое', 'какие', 'какого', 'какую', 'каким', 'каких', 'каков', 'какова', 'каковы', 'который', 'которая', 'которое',
  'сколько', 'где', 'куда', 'откуда', 'когда', 'зачем', 'почему', 'отчего', 'как', 'насколько']);
const LEAD = new Set(['а', 'и', 'но', 'ну', 'так', 'же', 'да', 'вот', 'ведь', 'о', 'об', 'в', 'на', 'с', 'у', 'к', 'по', 'за', 'из', 'от', 'для', 'до', 'при']);

/** True for a question that should get the rising tone: ends with "?" and does not start with a question word. */
export function risingQuestion(text) {
  if (!/\?[»”"')\]!…. ]*$/.test(text)) return false;
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]+/gu) || [];
  let i = 0;
  while (i < words.length && i < 3 && LEAD.has(words[i])) i++;
  return !(words[i] && WH.has(words[i]));
}

/** Index of the last sample that still belongs to speech (trailing silence skipped). */
function speechEnd(wave) {
  let peak = 0;
  for (let i = 0; i < wave.length; i++) { const v = wave[i] < 0 ? -wave[i] : wave[i]; if (v > peak) peak = v; }
  let end = wave.length - 1;
  while (end > 0 && Math.abs(wave[end]) < peak * 0.04) end--;
  return end;
}

const HOP = 0.01;

/** Voice period (in samples) every 10 ms between `from` and `to`; 0 where there is no voice. */
function periods(wave, sr, from, to, peak) {
  const hop = Math.round(sr * HOP), win = Math.round(sr * 0.032), lo = Math.floor(sr / 450), hi = Math.floor(sr / 70);
  const raw = [];
  for (let c = from; c <= to; c += hop) {
    const s = Math.max(0, c - (win >> 1)), e = Math.min(wave.length - hi - 1, s + win);
    let energy = 0;
    for (let i = s; i < e; i++) energy += wave[i] * wave[i];
    let best = 0, lag = 0;
    if (e > s && energy / (e - s) > peak * peak * 0.002) {
      const r = new Float32Array(hi + 2);
      for (let l = lo; l <= hi; l++) {
        let x = 0, b = 0;
        for (let i = s; i < e; i++) { x += wave[i] * wave[i + l]; b += wave[i + l] * wave[i + l]; }
        r[l] = x / Math.sqrt(energy * b + 1e-12);
        if (r[l] > best) best = r[l];
      }
      // the first strong peak, not the strongest: a double period correlates just as well
      for (let l = lo + 1; l < hi; l++) if (r[l] >= best * 0.9 && r[l] >= r[l - 1] && r[l] >= r[l + 1]) { lag = l; break; }
    }
    raw.push(best > 0.5 ? lag : 0);
  }
  // median of five voiced neighbours removes slips to half or double the period
  const list = raw.map((v, i) => {
    if (!v) return 0;
    const near = raw.slice(Math.max(0, i - 2), i + 3).filter(Boolean).sort((a, b) => a - b);
    const m = near[near.length >> 1];
    return Math.abs(v - m) > m * 0.25 ? m : v;
  });
  return { hop, from, list };
}

/** How periodic the sound is around sample c with period T (1 = perfectly). */
function steadiness(wave, c, T) {
  let x = 0, a = 0, b = 0;
  for (let i = c - T; i < c + T; i++) {
    if (i < 0 || i + T >= wave.length) continue;
    x += wave[i] * wave[i + T]; a += wave[i] * wave[i]; b += wave[i + T] * wave[i + T];
  }
  return x / Math.sqrt(a * b + 1e-12);
}

/** The lag near T (±20 %) at which the sound around m best repeats itself: the local voice period. */
function refine(wave, m, T) {
  const half = T >> 1, span = Math.max(2, Math.round(T * 0.2));
  let best = -Infinity, lag = T;
  for (let l = T - span; l <= T + span; l++) {
    let x = 0, b = 0;
    for (let i = m - half; i < m + half; i++) {
      if (i < 0 || i + l >= wave.length) continue;
      x += wave[i] * wave[i + l]; b += wave[i + l] * wave[i + l];
    }
    const r = x / Math.sqrt(b + 1e-12);
    if (r > best) { best = r; lag = l; }
  }
  return lag;
}

/**
 * The simple way to raise the end: play the last fifth of a second progressively faster. It shifts the
 * timbre along with the pitch, so it is used only where the period-by-period method cannot be trusted.
 */
function speedLift(wave, sr, end, lift) {
  const a = Math.max(0, end - Math.round(sr * 0.2)), n = wave.length;
  const out = new Float32Array(n);
  out.set(wave.subarray(0, a));
  let o = a, pos = a;
  while (pos < end) {
    const i = Math.floor(pos), f = pos - i;
    out[o++] = wave[i] * (1 - f) + wave[i + 1 < n ? i + 1 : i] * f;
    const t = (pos - a) / (end - a);
    pos += 1 + lift * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t * 1.6)));
  }
  for (let i = Math.ceil(pos); i < n; i++) out[o++] = wave[i];
  return out.subarray(0, o);
}

/**
 * End a yes/no question on a rising tone: the last voiced stretch (the final syllable) is lifted.
 * @param {Float32Array} wave
 * @param {number} lift  pitch ratio minus one at the very end (0.35 ≈ five semitones)
 * @returns {Float32Array} the changed wave (it may be a few milliseconds shorter)
 */
export function questionLift(wave, sr, lift) {
  const n = wave.length;
  if (!lift || n < sr * 0.3) return wave;
  let peak = 0;
  for (let i = 0; i < n; i++) { const v = wave[i] < 0 ? -wave[i] : wave[i]; if (v > peak) peak = v; }
  if (!peak) return wave;
  const end = speechEnd(wave);
  const track = periods(wave, sr, Math.max(0, end - Math.round(sr * 0.45)), end, peak);
  const list = track.list;

  // the last voiced stretch: it must reach (almost) to the end of the phrase and last at least 60 ms
  let j = list.length - 1;
  while (j >= 0 && !list[j]) j--;
  let i = j;
  while (i > 0 && list[i - 1]) i--;
  if (j < 0 || (list.length - 1 - j) * HOP > 0.25) return wave; // the phrase ends without a voice: nothing to raise
  const plain = () => speedLift(wave, sr, end, lift * 0.7);
  if ((j - i + 1) * HOP < 0.04) return plain();
  const s0 = track.from + i * track.hop, s1 = Math.min(end, track.from + j * track.hop);
  const periodAt = t => list[Math.min(j, Math.max(i, Math.round((t - track.from) / track.hop)))];

  const ramp = Math.min(Math.round(sr * 0.11), Math.round((s1 - s0) * 0.6));
  const ratio = t => (t >= s0 + ramp ? 1 + lift : 1 + lift * (0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, t - s0) / ramp)));

  // pitch marks one period apart, starting from the main peak of the first period
  const marks = [];
  let T = periodAt(s0), m = s0;
  for (let x = s0; x < s0 + T && x < n; x++) if (wave[x] > wave[m]) m = x;
  while (m <= s1 && m + 2 * T < n) {
    marks.push(m);
    T = refine(wave, m, periodAt(m) || T);
    m += T;
  }
  if (marks.length < 5) return plain();
  const gaps = marks.slice(1).map((v, q) => v - marks[q]).sort((x, y) => x - y), mid = gaps[gaps.length >> 1];
  if (gaps[0] < mid * 0.7 || gaps[gaps.length - 1] > mid * 1.3) return plain(); // the voice is not steady enough here

  const first = marks[0], last = marks[marks.length - 1];
  const acc = new Float32Array(last - first + 1), norm = new Float32Array(last - first + 1);
  let k = 0;
  for (let t = first; t <= last;) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1] - t) <= Math.abs(marks[k] - t)) k++;
    const src = marks[k];
    const P = k + 1 < marks.length ? marks[k + 1] - src : src - marks[k - 1];
    const at = Math.round(t);
    for (let d = -P; d <= P; d++) {
      const o = at + d - first, x = src + d;
      if (o < 0 || o >= acc.length || x < 0 || x >= n) continue;
      const w = 0.5 * (1 + Math.cos(Math.PI * d / P));
      acc[o] += wave[x] * w;
      norm[o] += w;
    }
    t += P / ratio(t);
  }
  const edge = Math.max(1, Math.min(marks[1] - first, Math.floor(acc.length / 2)));
  const out = Float32Array.from(wave);
  for (let o = 0; o < acc.length; o++) {
    const v = norm[o] > 0.05 ? acc[o] / norm[o] : wave[first + o];
    const fade = Math.min(1, o / edge, (acc.length - 1 - o) / edge);
    out[first + o] = wave[first + o] * (1 - fade) + v * fade;
  }

  // Judge by the settled part (after the ramp, without the two blended frames at the end): the tone must
  // really be higher there and the voice still steady. Otherwise fall back to the simple way.
  const after = periods(out, sr, track.from, end, peak).list;
  let good = 0, seen = 0;
  for (let f = i + Math.ceil(ramp / track.hop) + 1; f <= j - 2; f++) {
    if (!list[f]) continue;
    seen++;
    const r = after[f] ? list[f] / after[f] : 0;
    if (r > 1 + lift * 0.5 && r < 1 + lift * 1.5) good++;
  }
  if (seen >= 2 && good < seen * 0.6) return plain();
  return out;
}
