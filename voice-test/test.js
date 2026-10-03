// Voice check page: lets the owner hear the voices on her own phone and records whether
// speech survives a locked screen (the one thing that cannot be verified on a desktop).
import { TtsPlayer } from '../tts/player.js';
import { toUnits } from '../tts/text.js';

const SHORT = `Говорили, что на набережной появилось новое лицо: дама с собачкой. Дмитрий Дмитрич Гуров, проживший в Ялте уже две недели и привыкший тут, тоже стал интересоваться новыми лицами. Сидя в павильоне у Верне, он видел, как по набережной прошла молодая дама, невысокого роста блондинка, в берете; за нею бежал белый шпиц.
И потом он встречал её в городском саду и на сквере по нескольку раз в день. Она гуляла одна, всё в том же берете, с белым шпицем; никто не знал, кто она, и называли её просто так: дама с собачкой.
— Если она здесь без мужа и без знакомых, — соображал Гуров, — то было бы не лишнее познакомиться с ней.`;

const LONG = `Осенью темнеет рано. К шести часам за окном уже синеет, в доме напротив загораются окна, и город становится похож на большую книжную полку, где каждая освещённая комната — отдельная история.
Вера ставит чайник, достаёт с полки начатый роман и устраивается в кресле у лампы. Закладка лежит на сто двадцать четвёртой странице. Вчера она остановилась на самом интересном месте: герой получил письмо, но так и не решился его открыть.
— Ну что, — говорит она вслух, — посмотрим, что там написано.
Первые страницы всегда читаются медленно. Нужно вспомнить имена, расставить всех по местам, снова услышать голос автора. Зато потом текст подхватывает и несёт, как тёплое течение. Шум улицы стихает, чай остывает на подоконнике, а стрелки часов двигаются сами по себе.
Говорят, что книга живёт дважды. В первый раз — когда её пишут, во второй — когда читают. У каждого читателя получается своя история: кто-то запомнит погоню, кто-то разговор на веранде, а кто-то единственную фразу, которая почему-то попала точно в сердце.
Вера читает сорок минут, потом ещё двадцать. В главе появляется старый замок на холме, а в двери замка — тяжёлый ржавый замок, который никто не открывал с тысяча восемьсот девяносто девятого года. Герой долго стоит перед дверью. Ему страшно и любопытно одновременно. Разве не так бывает перед каждой новой главой собственной жизни?
Письмо оказывается коротким. Всего три строчки, но после них уже ничего нельзя оставить по-прежнему. Вера откладывает книгу, смотрит в тёмное окно и улыбается. Тридцать страниц за вечер — немного, зато каждая из них была прочитана по-настоящему.
Завтра она продолжит. А пока закладка переезжает на сто пятьдесят четвёртую страницу, лампа гаснет, и история терпеливо ждёт на тумбочке, как ждут только хорошие книги.`;

const VOICES = { 'ru_RU-irina-medium': 'Ирина', 'ru_RU-dmitri-medium': 'Дмитрий' };
const $ = sel => document.querySelector(sel);
const player = new TtsPlayer();

// ---------- small helpers ----------
const mb = n => (n / 1048576).toFixed(0);
const num = (n, digits = 1) => n.toFixed(digits).replace('.', ',');
function dur(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m} мин ${String(s).padStart(2, '0')} с` : `${s} с`;
}
function device() {
  const ua = navigator.userAgent;
  const ios = ua.match(/(iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/);
  const ver = ua.match(/Version\/([\d.]+)/);
  const where = ios ? `${ios[1]}, iOS ${ios[2].replace(/_/g, '.')}` : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac') : 'компьютер';
  return where + (ver ? `, Safari ${ver[1]}` : '');
}
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

const lines = [];
function log(text) {
  lines.push(`${new Date().toLocaleTimeString('ru-RU')}  ${text}`);
  $('#log').textContent = lines.slice(-250).join('\n');
}

// ---------- texts ----------
function renderText(el, text) {
  const units = toUnits(text);
  el.textContent = '';
  let para = el.appendChild(document.createElement('p'));
  units.forEach((u, i) => {
    const span = para.appendChild(document.createElement('span'));
    span.textContent = u.text + ' ';
    span.dataset.i = i;
    if (u.paraEnd && i < units.length - 1) para = el.appendChild(document.createElement('p'));
  });
  return units;
}
const shortUnits = renderText($('#shortText'), SHORT);
const longUnits = renderText($('#longText'), LONG);

// ---------- voice ----------
let loadInfo = null;
const playButtons = ['#playShort', '#playLong', '#playOwn'].map($);
function status(text, bad) {
  const el = $('#loadStatus');
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
}
function progress(fraction) { $('#loadBar').firstElementChild.style.width = Math.round(Math.min(1, fraction) * 100) + '%'; }

async function chooseVoice(id) {
  const buttons = [...document.querySelectorAll('[data-voice]')];
  buttons.forEach(b => { b.disabled = true; b.classList.remove('on'); });
  playButtons.forEach(b => { b.disabled = true; });
  $('#player').hidden = true;
  $('#loadBar').hidden = false;
  progress(0);
  status('Загружаю голос…');
  const started = Date.now();
  let downloaded = false;
  try {
    await player.load(id, p => {
      if (p.stage === 'engine') { downloaded = true; status(`Загружаю движок: ${mb(p.loaded)} из ${mb(p.total)} МБ`); progress(p.loaded / p.total * 0.34); }
      else if (p.stage === 'voice') { downloaded = true; status(`Загружаю голос: ${mb(p.loaded)} из ${mb(p.total)} МБ`); progress(0.34 + p.loaded / p.total * 0.66); }
      else if (p.stage === 'start') { status('Запускаю голос…'); progress(1); }
    });
    loadInfo = { voice: id, sec: (Date.now() - started) / 1000, downloaded };
    status(`Голос «${VOICES[id]}» готов.`);
    log(`голос ${VOICES[id]} готов за ${num(loadInfo.sec)} с${downloaded ? '' : ' (из памяти устройства)'}`);
    buttons.find(b => b.dataset.voice === id).classList.add('on');
    playButtons.forEach(b => { b.disabled = false; });
  } catch (err) {
    status('Не получилось загрузить голос: ' + err.message, true);
    log('ошибка загрузки голоса: ' + err.message);
  }
  $('#loadBar').hidden = true;
  buttons.forEach(b => { b.disabled = false; });
}
document.querySelectorAll('[data-voice]').forEach(b => b.addEventListener('click', () => chooseVoice(b.dataset.voice)));

// ---------- runs and the report ----------
let run = null;
const watch = { since: Date.now(), hiddenActive: 0, hiddenPlayedFrom: 0, hiddenUnitsFrom: 0, visits: [] };
const active = () => player.state === 'playing' || player.state === 'buffering';
let wasActive = false, wasHidden = document.hidden;

/** Add up how long the player was supposed to be speaking while the page was hidden. */
function account() {
  const now = Date.now();
  if (wasActive && wasHidden) watch.hiddenActive += (now - watch.since) / 1000;
  watch.since = now;
  wasActive = active();
  wasHidden = document.hidden;
}

function begin(name, units, el, loop) {
  if (!player.voice || !units.length) return;
  document.querySelectorAll('.text span.now').forEach(s => s.classList.remove('now'));
  run = { name, units, el, loop, startedAt: Date.now() };
  watch.visits = [];
  player.setMeta({ title: name, artist: 'Глава: проверка голоса', album: VOICES[player.voice] });
  player.start(units, { loop });
  $('#player').hidden = false;
  $('#nowText').textContent = 'Готовлю первую фразу…';
  log(`старт: ${name}, фраз ${units.length}${loop ? ', по кругу' : ''}`);
}
$('#playShort').addEventListener('click', () => begin('Короткий отрывок', shortUnits, $('#shortText'), false));
$('#playLong').addEventListener('click', () => begin('Долгое чтение', longUnits, $('#longText'), true));
$('#playOwn').addEventListener('click', () => {
  const units = toUnits($('#ownText').value);
  if (!units.length) { $('#ownText').focus(); return; }
  begin('Свой текст', units, null, false);
});

document.addEventListener('visibilitychange', () => {
  account();
  if (document.hidden) {
    watch.hiddenActive = 0;
    watch.hiddenAt = Date.now();
    watch.hiddenPlayedFrom = player.playedSec;
    watch.hiddenUnitsFrom = player.stats.units;
    watch.rate = player.rate;
    log('страница скрыта (экран выключен или приложение свёрнуто)');
  } else if (watch.hiddenAt) {
    const visit = {
      wall: (Date.now() - watch.hiddenAt) / 1000,
      expected: watch.hiddenActive * watch.rate,
      played: player.playedSec - watch.hiddenPlayedFrom,
      units: player.stats.units - watch.hiddenUnitsFrom,
      audioStopped: active() && player.audio.paused,
    };
    watch.hiddenAt = 0;
    if (run && visit.expected > 1) watch.visits.push(visit);
    log(`страница снова видна: прошло ${dur(visit.wall)}, должно было прозвучать ${dur(visit.expected)}, прозвучало ${dur(visit.played)}, озвучено фраз ${visit.units}`);
    renderReport();
  }
});
for (const name of ['pagehide', 'pageshow', 'freeze', 'resume']) {
  (name === 'freeze' || name === 'resume' ? document : window).addEventListener(name, () => log('событие: ' + name));
}

function verdict() {
  const long = watch.visits.filter(v => v.expected >= 20);
  if (!long.length) return 'Пока проверен только звук с включённым экраном.';
  const worst = Math.min(...long.map(v => v.played / v.expected));
  if (worst >= 0.9) return 'Голос не замолкал при выключенном экране.';
  if (worst >= 0.5) return 'При выключенном экране голос шёл с перебоями.';
  return 'При выключенном экране голос замолчал.';
}

function reportRows() {
  const s = player.stats;
  const rows = [
    ['Устройство', device()],
    ['Запуск', standalone() ? 'с экрана «Домой»' : 'в браузере'],
    ['Голос', loadInfo ? `${VOICES[loadInfo.voice]}, готов за ${num(loadInfo.sec)} с${loadInfo.downloaded ? '' : ' (из памяти)'}` : 'не выбран'],
  ];
  if (run) {
    rows.push(['Текст', run.name]);
    if (s.firstSoundMs != null) rows.push(['Первый звук', `через ${num(s.firstSoundMs / 1000)} с`]);
    if (s.units) rows.push(['Скорость озвучки', `в ${num(s.synthSec * 1000 / s.synthMs)} раза быстрее речи (минимум ${num(s.worst)})`]);
    rows.push(['Прозвучало', `${dur(player.playedSec)}, фраз озвучено ${s.units}`]);
    rows.push(['Ожидание голоса', s.underruns ? `${s.underruns} раз, всего ${num(s.underrunSec)} с` : 'не было']);
    watch.visits.forEach((v, i) => rows.push([`Экран выключен ${i + 1}`, `${dur(v.wall)}: прозвучало ${dur(v.played)} из ${dur(v.expected)}, озвучено фраз ${v.units}${v.audioStopped ? ', звук остановлен системой' : ''}`]));
  }
  return rows;
}

function renderReport() {
  if (!run) return;
  const box = $('#report');
  box.textContent = '';
  const head = box.appendChild(document.createElement('p'));
  head.className = 'verdict';
  head.textContent = verdict();
  const dl = box.appendChild(document.createElement('dl'));
  for (const [k, v] of reportRows()) {
    dl.appendChild(document.createElement('dt')).textContent = k;
    dl.appendChild(document.createElement('dd')).textContent = v;
  }
  $('#copyReport').disabled = false;
}

$('#copyReport').addEventListener('click', async () => {
  const text = ['Глава, проверка голоса', verdict(), ...reportRows().map(([k, v]) => `${k}: ${v}`), '', 'Журнал:', ...lines.slice(-60)].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    $('#copyStatus').textContent = 'Отчёт скопирован, вставь его в чат.';
  } catch (e) {
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    $('#copyStatus').textContent = 'Выдели текст ниже и скопируй:';
    $('#copyStatus').after(area);
    area.select();
  }
});

// ---------- player bar ----------
const ICON = { pause: 'M7 5h4v14H7zM13 5h4v14h-4z', play: 'M7 4.5v15l12-7.5z' };
player.addEventListener('state', e => {
  account();
  const state = e.detail.state;
  const playing = state === 'playing' || state === 'buffering';
  $('#toggleIcon').firstElementChild.setAttribute('d', playing ? ICON.pause : ICON.play);
  $('#toggle').setAttribute('aria-label', playing ? 'Пауза' : 'Продолжить');
  if (state === 'ended') { $('#nowText').textContent = 'Отрывок закончился.'; log('конец текста'); }
  if (state === 'paused' || state === 'ended') renderReport();
});
player.addEventListener('unit', e => {
  const { index, unit } = e.detail;
  const label = $('#nowText');
  label.textContent = '';
  label.appendChild(document.createElement('b')).textContent = 'Сейчас: ';
  label.append(unit.text);
  if (run && run.el) {
    run.el.querySelectorAll('span.now').forEach(s => s.classList.remove('now'));
    const span = run.el.querySelector(`span[data-i="${index % run.units.length}"]`);
    if (span) span.classList.add('now');
  }
  if (index % 10 === 0) renderReport();
});
player.addEventListener('log', e => log(e.detail.text));
player.addEventListener('interrupted', () => log('воспроизведение прервано системой'));
player.addEventListener('blocked', () => { $('#nowText').textContent = 'Нажми «Продолжить», чтобы голос зазвучал.'; });

$('#toggle').addEventListener('click', () => player.toggle());
$('#prev').addEventListener('click', () => player.skip(-1));
$('#next').addEventListener('click', () => player.skip(1));
// Speed in steps of 0.1, remembered between visits.
const RATE_KEY = 'glava-voice-rate', RATE_MIN = 0.7, RATE_MAX = 2;
function setRate(rate, quiet) {
  rate = Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(rate * 10) / 10));
  player.setRate(rate);
  $('#rate').textContent = num(rate) + '×';
  $('#slower').disabled = rate <= RATE_MIN;
  $('#faster').disabled = rate >= RATE_MAX;
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch (e) { /* private mode */ }
  if (!quiet) log('скорость ' + num(rate));
}
$('#slower').addEventListener('click', () => setRate(player.rate - 0.1));
$('#faster').addEventListener('click', () => setRate(player.rate + 0.1));
let savedRate = 1;
try { savedRate = parseFloat(localStorage.getItem(RATE_KEY)) || 1; } catch (e) { /* private mode */ }
setRate(savedRate, true);

log(`страница открыта: ${device()}, ${standalone() ? 'с экрана «Домой»' : 'в браузере'}`);
