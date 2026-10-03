// Speech synthesis off the main thread: text → phonemes (espeak-ng) → sound (a Piper voice run by ONNX Runtime).
// Everything it needs is served by the app itself and kept in Cache Storage, so after the first load it works offline.
import * as ort from '../vendor/ort/ort.wasm.bundle.min.mjs';
import createPiperPhonemize from '../vendor/piper/piper_phonemize.mjs';
import { questionLift } from './prosody.js';

const ROOT = new URL('../', import.meta.url);
const CACHE = 'glava-voice-v1';
const SIZE = { phonData: 18077249, runtime: 14239897, voice: 63201294 };
const GAIN = 2.0; // Piper voices come out quiet; lift them, but never past full scale.
// Voices that already end a question on a rising tone by themselves (no help needed).
const NATIVE_QUESTIONS = new Set(['ru_RU-ruslan-medium']);

ort.env.wasm.numThreads = 1; // GitHub Pages cannot send the headers threads need; one thread is fast enough.

let phon = null;
const phonOut = [];
let session = null, cfg = null, voiceId = '';
let gen = 0, busy = false;
const jobs = [];

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

/** Fetch through Cache Storage, reporting download progress. */
async function cached(path, onProgress, expected) {
  const url = new URL(path, ROOT).href;
  let cache = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch (e) { /* private mode: no cache, just download */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
  let buf;
  if (res.body && onProgress) {
    const total = expected || +res.headers.get('Content-Length') || 0;
    const reader = res.body.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      n += value.length;
      onProgress(n, Math.max(total, n));
    }
    const all = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    buf = all.buffer;
  } else {
    buf = await res.arrayBuffer();
  }
  try {
    if (cache) await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }));
  } catch (e) { /* storage full: still usable this session */ }
  return buf;
}

async function loadEngine() {
  if (phon) return;
  const progress = (part, weight, offset) => (n, total) => post({ type: 'progress', stage: 'engine', loaded: offset + n, total: SIZE.phonData + SIZE.runtime, part });
  const wasmBinary = await cached('vendor/piper/piper_phonemize.wasm');
  const data = await cached('vendor/piper/piper_phonemize.data', progress('phonemes', 0, 0), SIZE.phonData);
  ort.env.wasm.wasmBinary = await cached('vendor/ort/ort-wasm-simd-threaded.wasm', progress('runtime', 0, SIZE.phonData), SIZE.runtime);
  phon = await createPiperPhonemize({
    print: line => phonOut.push(line),
    printErr: () => {},
    wasmBinary,
    getPreloadedPackage: () => data,
    locateFile: file => new URL('vendor/piper/' + file, ROOT).href,
  });
}

async function loadVoice(id) {
  const t0 = performance.now();
  await loadEngine();
  cfg = JSON.parse(new TextDecoder().decode(await cached(`voices/${id}.onnx.json`)));
  const model = await cached(`voices/${id}.onnx`, (n, total) => post({ type: 'progress', stage: 'voice', loaded: n, total }), SIZE.voice);
  post({ type: 'progress', stage: 'start', loaded: 0, total: 0 });
  if (session) { try { await session.release(); } catch (e) {} session = null; }
  session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  voiceId = id;
  return { voice: id, sampleRate: cfg.audio.sample_rate, ms: Math.round(performance.now() - t0) };
}

function phonemize(text) {
  phonOut.length = 0;
  phon.callMain(['-l', cfg.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  const ids = [];
  for (const line of phonOut) {
    try { ids.push(...JSON.parse(line).phoneme_ids); } catch (e) { /* not a result line */ }
  }
  return ids;
}

async function synth(text, lengthScale, rise) {
  const ids = phonemize(text);
  if (!ids.length) return new Int16Array(0);
  const inf = cfg.inference || {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) * (lengthScale || 1), inf.noise_w ?? 0.8]), [3]),
  };
  if ((cfg.num_speakers || 1) > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  let wave = out[session.outputNames[0]].data;
  if (rise && !NATIVE_QUESTIONS.has(voiceId)) wave = questionLift(wave, cfg.audio.sample_rate, rise);
  let peak = 0;
  for (let i = 0; i < wave.length; i++) { const a = wave[i] < 0 ? -wave[i] : wave[i]; if (a > peak) peak = a; }
  const gain = peak > 0 ? Math.min(GAIN, 0.97 / peak) : 1;
  const pcm = new Int16Array(wave.length);
  for (let i = 0; i < wave.length; i++) pcm[i] = Math.round(wave[i] * gain * 32767);
  return pcm;
}

async function pump() {
  if (busy) return;
  busy = true;
  while (jobs.length) {
    const job = jobs.shift();
    try {
      if (job.type === 'load') {
        post({ type: 'ready', ...(await loadVoice(job.voice)) });
      } else if (job.gen === gen) {
        const t0 = performance.now();
        const pcm = await synth(job.text, job.lengthScale, job.rise);
        if (job.gen === gen) post({ type: 'audio', id: job.id, gen: job.gen, pcm, sampleRate: cfg.audio.sample_rate, ms: performance.now() - t0 }, [pcm.buffer]);
      }
    } catch (err) {
      post({ type: 'error', id: job.id, gen: job.gen, during: job.type, message: String((err && err.message) || err) });
    }
  }
  busy = false;
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'reset') {
    gen = msg.gen;
    for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].type === 'synth') jobs.splice(i, 1);
    return;
  }
  jobs.push(msg);
  pump();
};
