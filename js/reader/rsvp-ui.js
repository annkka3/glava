// A second view of the open book. Only this overlay is measured and resized;
// changing the word or its font size must never repaginate the underlying reader.
import { splitFocus } from './rsvp.js';

const clampSpeed = value => Math.max(100, Math.min(600, Math.round((Number(value) || 250) / 10) * 10));
const textOf = value => typeof value === 'string' ? value : '';

const markup = `
  <div class="rsvp-inner">
    <div class="rsvp-heading-row">
      <h2 class="rsvp-heading">Слово за словом</h2>
      <button type="button" class="rsvp-exit" data-rsvp-action="exit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5-7 7 7 7M3 12h18"/></svg>
        <span>Обычная страница</span>
      </button>
    </div>
    <div class="rsvp-content">
      <div class="rsvp-focus-area">
        <p class="rsvp-chapter"></p>
        <div class="rsvp-stage">
          <span class="rsvp-guide rsvp-guide-top" aria-hidden="true"></span>
          <span class="rsvp-guide rsvp-guide-bottom" aria-hidden="true"></span>
          <span class="rsvp-word-anchor" aria-live="off" role="img" hidden><span class="rsvp-before" aria-hidden="true"></span><span class="rsvp-pivot" aria-hidden="true"></span><span class="rsvp-after" aria-hidden="true"></span></span>
          <p class="rsvp-placeholder">Подготавливаю текст…</p>
        </div>
        <div class="rsvp-position-row">
          <p class="rsvp-position"></p>
          <p class="rsvp-state" role="status" aria-live="polite" aria-atomic="true">Подготавливаю текст…</p>
        </div>
        <div class="rsvp-progress" role="progressbar" aria-label="Место в книге" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        <div class="rsvp-context-wrap">
          <p class="rsvp-context" aria-label="Текущий фрагмент"></p>
          <p class="rsvp-context-hint">На паузе здесь появится контекст.</p>
        </div>
      </div>
      <div class="rsvp-controls">
        <div class="rsvp-transport" role="group" aria-label="Управление чтением по словам">
          <button type="button" class="rsvp-back" data-rsvp-action="back" aria-label="Назад на 10 слов" title="Назад на 10 слов" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6-5 5 5 5M4 11h10a6 6 0 0 1 0 12" transform="translate(0 -3)"/></svg>
            <span>−10 слов</span>
          </button>
          <button type="button" class="rsvp-toggle" data-rsvp-action="toggle" aria-label="Начать чтение по словам" disabled>
            <svg class="rsvp-play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8z"/></svg>
            <svg class="rsvp-pause-icon" viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
            <span class="rsvp-toggle-label">Начать</span>
          </button>
          <button type="button" class="rsvp-sentence" data-rsvp-action="sentence" aria-label="К началу предложения" title="К началу предложения" disabled>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14M19 6l-9 6 9 6z"/></svg>
            <span>К началу<br>предложения</span>
          </button>
        </div>
        <div class="rsvp-speed">
          <div class="rsvp-speed-heading"><span>Базовый темп</span><output><strong class="rsvp-speed-value">250</strong> <span>слов/мин</span></output></div>
          <div class="rsvp-speed-inputs">
            <button type="button" data-rsvp-adjust="-10" aria-label="Медленнее на 10 слов в минуту">−</button>
            <input type="range" data-rsvp-setting="wpm" min="100" max="600" step="10" value="250" aria-label="Скорость, слов в минуту">
            <button type="button" data-rsvp-adjust="10" aria-label="Быстрее на 10 слов в минуту">+</button>
          </div>
          <p class="rsvp-speed-note">С учётом пауз фактический темп может быть ниже.</p>
        </div>
        <details class="rsvp-options">
          <summary>Настройки режима <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
          <label><span>Красная опорная буква</span><input type="checkbox" data-rsvp-setting="focus" checked></label>
          <label><span>Паузы на знаках препинания</span><input type="checkbox" data-rsvp-setting="punctuation" checked></label>
          <label><span>Дольше на длинных словах</span><input type="checkbox" data-rsvp-setting="longWords" checked></label>
        </details>
        <p class="rsvp-keyboard-hint">Пробел — пауза · ← — назад · Esc — страница</p>
      </div>
    </div>
  </div>`;

/**
 * Mount into the reader's own container, below .r-top.
 * onAction receives 'toggle', 'back', 'sentence', or 'exit'.
 * onSettings receives a partial { wpm, focus, punctuation, longWords } object.
 * No navigation, playback, persistence, or book content parsing happens here.
 */
export function createWordModeUI(container, { onAction, onSettings } = {}) {
  if (!container) throw new TypeError('Word mode needs a container');
  container.classList.add('rsvp-panel');
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Чтение по словам');
  container.tabIndex = -1;
  // This is static UI markup. Book text is always assigned using textContent.
  container.innerHTML = markup;
  const $ = selector => container.querySelector(selector);
  const node = {
    stage: $('.rsvp-stage'), anchor: $('.rsvp-word-anchor'), before: $('.rsvp-before'),
    pivot: $('.rsvp-pivot'), after: $('.rsvp-after'), placeholder: $('.rsvp-placeholder'),
    chapter: $('.rsvp-chapter'), position: $('.rsvp-position'), state: $('.rsvp-state'),
    progress: $('.rsvp-progress'), progressFill: $('.rsvp-progress i'),
    context: $('.rsvp-context'), contextHint: $('.rsvp-context-hint'),
    toggle: $('[data-rsvp-action="toggle"]'), toggleLabel: $('.rsvp-toggle-label'),
    back: $('[data-rsvp-action="back"]'), sentence: $('[data-rsvp-action="sentence"]'),
    play: $('.rsvp-play-icon'), pause: $('.rsvp-pause-icon'),
    speed: $('[data-rsvp-setting="wpm"]'), speedValue: $('.rsvp-speed-value'),
    slower: $('[data-rsvp-adjust="-10"]'), faster: $('[data-rsvp-adjust="10"]'),
    focus: $('[data-rsvp-setting="focus"]'), punctuation: $('[data-rsvp-setting="punctuation"]'),
    longWords: $('[data-rsvp-setting="longWords"]'),
  };
  let settings = { wpm: 250, focus: true, punctuation: true, longWords: true };
  let state = 'loading', currentWord = null, renderedText = null, loadingAfterPlayback = false;
  let baseSize = 48, destroyed = false, fitFrame = 0;
  const doc = container.ownerDocument;
  const win = doc.defaultView;

  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };

  function fitWord() {
    fitFrame = 0;
    if (destroyed || node.anchor.hidden || !container.isConnected) return;
    const width = node.stage.clientWidth;
    if (!width) return;
    node.anchor.style.fontSize = `${baseSize}px`;
    // The anchor's intrinsic width is exactly the pivot glyph. Its centre is on
    // the 40% axis; before/after are positioned outside it, not centred as a word.
    const halfPivot = node.pivot.getBoundingClientRect().width / 2;
    const left = node.before.getBoundingClientRect().width + halfPivot;
    const right = node.after.getBoundingClientRect().width + halfPivot;
    const factor = Math.min(1, (width * 0.4 - 12) / Math.max(1, left), (width * 0.6 - 12) / Math.max(1, right));
    if (factor < 1) node.anchor.style.fontSize = `${Math.max(1, baseSize * factor * 0.98)}px`;
  }

  function scheduleFit() {
    if (!destroyed && !fitFrame) fitFrame = win.requestAnimationFrame(fitWord);
  }

  function showSettings(next) {
    settings = { ...settings, ...next, wpm: clampSpeed(next?.wpm ?? settings.wpm) };
    node.speed.value = String(settings.wpm);
    node.speed.setAttribute('aria-valuetext', `${settings.wpm} слов в минуту`);
    setText(node.speedValue, String(settings.wpm));
    node.slower.disabled = settings.wpm <= 100;
    node.faster.disabled = settings.wpm >= 600;
    for (const key of ['focus', 'punctuation', 'longWords']) node[key].checked = settings[key] !== false;
    container.classList.toggle('rsvp-no-focus', settings.focus === false);
    $('.rsvp-speed-note').hidden = settings.punctuation === false && settings.longWords === false;
  }

  function changeSettings(patch) {
    if (destroyed) return;
    showSettings(patch);
    onSettings?.(patch);
  }

  function action(name) {
    if (destroyed) return;
    // A chapter may be loading while playback is still requested. Keep Pause
    // available then, without offering autoplay during the initial preparation.
    const canPauseLoading = name === 'toggle' && loadingAfterPlayback && currentWord;
    if (name !== 'exit' && ((state === 'loading' && !canPauseLoading) || state === 'error' || !currentWord)) return;
    if (name === 'toggle' && state === 'ended') return;
    onAction?.(name);
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !container.contains(button) || button.disabled) return;
    if (button.dataset.rsvpAction) action(button.dataset.rsvpAction);
    else if (button.dataset.rsvpAdjust) changeSettings({ wpm: clampSpeed(settings.wpm + Number(button.dataset.rsvpAdjust)) });
  }

  function onInput(event) {
    if (event.target === node.speed) changeSettings({ wpm: clampSpeed(event.target.value) });
  }

  function onChange(event) {
    const key = event.target.dataset.rsvpSetting;
    if (['focus', 'punctuation', 'longWords'].includes(key)) changeSettings({ [key]: event.target.checked });
  }

  function onKey(event) {
    if (destroyed || !container.isConnected || container.closest('[hidden]') || doc.querySelector('dialog[open]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || event.repeat) return;
    // Preserve native space/arrow behaviour for sliders, text and checkboxes.
    // Buttons keep their native Space activation but do not swallow the reading
    // shortcuts after a mouse click has left keyboard focus on a button.
    const nativeControl = event.target.closest?.('input,textarea,select,[contenteditable="true"]');
    const nativeActivation = event.target.closest?.('button,a,summary');
    let handled = true;
    if (event.key === 'Escape') action('exit');
    else if (nativeControl) return;
    else if (event.key === ' ' || event.code === 'Space') {
      if (nativeActivation) return;
      action('toggle');
    }
    else if (event.key === 'ArrowLeft') action('back');
    else if (event.key === 'Home') action('sentence');
    else if (event.key === '+' || event.key === '=') changeSettings({ wpm: clampSpeed(settings.wpm + 10) });
    else if (event.key === '-' || event.key === '−') changeSettings({ wpm: clampSpeed(settings.wpm - 10) });
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }

  function update(snapshot = {}) {
    if (destroyed) return;
    const nextState = snapshot.state || 'paused';
    loadingAfterPlayback = nextState === 'loading' && (state === 'playing' || (state === 'loading' && loadingAfterPlayback));
    state = nextState;
    currentWord = snapshot.word || null;
    showSettings(snapshot.settings || {});
    container.dataset.rsvpState = state;
    container.setAttribute('aria-busy', String(state === 'loading'));
    const word = currentWord;
    const text = textOf(word?.text);
    const canRead = Boolean(text) && state !== 'loading' && state !== 'error' && state !== 'ended';
    node.anchor.hidden = !canRead;
    node.placeholder.hidden = canRead;
    if (text !== renderedText) {
      const { before = '', pivot = '', after = '' } = splitFocus(text);
      setText(node.before, before);
      setText(node.pivot, pivot);
      setText(node.after, after);
      node.anchor.setAttribute('aria-label', text);
      renderedText = text;
      scheduleFit();
    }
    const message = state === 'loading' ? 'Подготавливаю текст…'
      : state === 'playing' ? 'Чтение идёт'
        : state === 'ended' ? 'Конец текста'
          : state === 'error' ? 'Не получилось открыть режим'
            : text ? 'Пауза' : 'В этом фрагменте нет текста';
    // Only state changes update this live region; individual words stay silent.
    setText(node.state, message);
    const error = typeof snapshot.error === 'string' ? snapshot.error : snapshot.error?.message;
    setText(node.placeholder, state === 'error' ? (textOf(error) || 'Вернись к обычной странице и попробуй ещё раз.').slice(0, 240) : message);
    const playing = state === 'playing' || loadingAfterPlayback;
    // SVGElement does not implement HTMLElement.hidden; toggle the actual
    // attribute so the pause icon replaces the play icon in every browser.
    node.play.toggleAttribute('hidden', playing);
    node.pause.toggleAttribute('hidden', !playing);
    setText(node.toggleLabel, playing ? 'Пауза' : 'Начать');
    node.toggle.setAttribute('aria-label', playing ? 'Пауза' : 'Начать чтение по словам');
    node.toggle.disabled = !canRead && !(loadingAfterPlayback && currentWord);
    const canSeek = Boolean(word) && state !== 'loading' && state !== 'error';
    node.back.disabled = !canSeek;
    node.sentence.disabled = !canSeek;
    setText(node.chapter, textOf(word?.chapter));
    const wordIndex = Number(word?.wordIndex), total = Number(word?.totalWords);
    setText(node.position, Number.isFinite(wordIndex) && total > 0 ? `Слово ${Math.min(total, wordIndex + 1)} из ${total}` : '');
    const fraction = Math.max(0, Math.min(1, Number(word?.fraction) || 0));
    node.progressFill.style.transform = `scaleX(${fraction})`;
    node.progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    const showContext = state === 'paused' || state === 'ended';
    node.context.hidden = !showContext;
    node.contextHint.hidden = showContext || state === 'error';
    if (showContext) setText(node.context, textOf(word?.context));
    // A chapter can finish loading with the same word that was supplied while
    // hidden; fit that word again when it actually becomes visible.
    if (canRead) scheduleFit();
  }

  function setLook({ family, size, dark } = {}) {
    if (destroyed) return;
    container.style.setProperty('--rsvp-family', family || "'Literata', Georgia, serif");
    baseSize = Math.max(32, Math.min(80, (Number(size) || 20) * 2.4));
    container.dataset.rsvpDark = String(Boolean(dark));
    scheduleFit();
  }

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);
  container.addEventListener('change', onChange);
  doc.addEventListener('keydown', onKey, true);
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(scheduleFit) : null;
  observer?.observe(node.stage);
  if (!observer) win.addEventListener('resize', scheduleFit);
  doc.fonts?.ready.then(scheduleFit);
  doc.fonts?.addEventListener?.('loadingdone', scheduleFit);
  showSettings(settings);

  return {
    update,
    setLook,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (fitFrame) win.cancelAnimationFrame(fitFrame);
      observer?.disconnect();
      win.removeEventListener('resize', scheduleFit);
      doc.fonts?.removeEventListener?.('loadingdone', scheduleFit);
      doc.removeEventListener('keydown', onKey, true);
      container.removeEventListener('click', onClick);
      container.removeEventListener('input', onInput);
      container.removeEventListener('change', onChange);
      container.replaceChildren();
      container.classList.remove('rsvp-panel', 'rsvp-no-focus');
      for (const attr of ['role', 'aria-label', 'aria-busy', 'tabindex', 'data-rsvp-state', 'data-rsvp-dark']) container.removeAttribute(attr);
      container.style.removeProperty('--rsvp-family');
    },
  };
}
