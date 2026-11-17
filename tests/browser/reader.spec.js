import { test, expect } from './test-support.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const pane = page => page.locator('#rWordsPane');
const word = page => pane(page).locator('.rsvp-word-anchor');
const toggle = page => pane(page).getByRole('button', { name: /^(Начать чтение по словам|Пауза)$/ });
const shownWord = page => word(page).getAttribute('aria-label');

async function prepareBook(page, format = 'fb2') {
  await page.goto('/');
  await page.waitForFunction(() => window.glava?.store.ready && window.glava?.hooks.importFile);
  const bytes = await readFile(fileURLToPath(new URL(`./fixtures/reading.${format}`, import.meta.url)));
  const id = await page.evaluate(async ({ base64, format }) => {
    const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    const file = new File([bytes], `reading.${format}`, {
      type: format === 'epub' ? 'application/epub+zip' : 'application/x-fictionbook+xml',
    });
    return window.glava.hooks.importFile(file);
  }, { base64: bytes.toString('base64'), format });
  expect(id).toBeTruthy();
  return id;
}

async function openBook(page, id) {
  await page.evaluate(id => window.glava.hooks.read(id), id);
  await expect(page.getByRole('button', { name: 'Закрыть книгу', exact: true })).toBeVisible();
  await page.waitForFunction(() => document.querySelector('foliate-view')?.lastLocation?.cfi);
}

async function startWords(page) {
  await page.locator('#rWordsToggle').click();
  await expect(pane(page)).toBeVisible();
  await expect(word(page)).toHaveAttribute('aria-label', /\S/);
  await expect(toggle(page)).toBeEnabled();
}

async function pause(page) {
  if (await toggle(page).getAttribute('aria-label') === 'Пауза') await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Начать чтение по словам');
}

async function play(page) {
  if (await toggle(page).getAttribute('aria-label') !== 'Пауза') await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Пауза');
}

async function ordinaryPage(page) {
  await pane(page).getByRole('button', { name: 'Обычная страница', exact: true }).click();
  await expect(pane(page)).toBeHidden();
  // The pane hides before Foliate finishes restoring the page. Focus returns to
  // this button only after that navigation has completed, when reentry is safe.
  await expect(page.locator('#rWordsToggle')).toBeFocused();
}

async function totals(page) {
  return page.evaluate(() => [...window.glava.store.days.values()].reduce((sum, day) => ({
    pages: sum.pages + (day.p || 0), minutes: sum.minutes + (day.m || 0),
    listening: sum.listening + (day.l || 0),
  }), { pages: 0, minutes: 0, listening: 0 }));
}

async function progress(page, id) {
  return page.evaluate(id => structuredClone(window.glava.store.books.get(id).prog), id);
}

async function selectWord(page, text) {
  // A native DOM selection in the real EPUB/FB2 iframe, not a fake engine cursor.
  return page.evaluate(text => {
    const view = document.querySelector('foliate-view');
    for (const { doc, index } of view.renderer.getContents()) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const at = node.textContent.indexOf(text);
        if (at < 0) continue;
        const range = doc.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const selection = doc.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        doc.dispatchEvent(new Event('selectionchange'));
        return view.getCFI(index, range);
      }
    }
    throw new Error(`Fixture selection was not found: ${text}`);
  }, text);
}

async function selectWordsMode(page, text) {
  await selectWord(page, text);
  await expect(page.locator('[data-r="words-from-selection"]')).toBeVisible();
  await page.locator('[data-r="words-from-selection"]').click();
  await expect(word(page)).toHaveAttribute('aria-label', /\S/);
  await pause(page);
}

for (const format of ['fb2', 'epub']) {
  test(`${format.toUpperCase()}: ordinary reading, selected word, and exact resume survive close/reload`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const id = await prepareBook(page, format);
    await openBook(page, id);
    await selectWordsMode(page, 'Изумрудный');
    await expect(word(page)).toHaveAttribute('aria-label', 'Изумрудный');

    // The mode really advances through the book, rather than merely replacing its shell.
    await play(page);
    await expect.poll(() => shownWord(page)).not.toBe('Изумрудный');
    await page.waitForTimeout(1600);
    await pause(page);
    const pausedWord = await shownWord(page);
    const before = await progress(page, id);
    expect(before.cfi).toMatch(/^epubcfi\(/);
    expect(before.word.cfi).toBe(before.cfi);

    await page.screenshot({ path: testInfo.outputPath(`words-${format}-390.png`), fullPage: true });
    await ordinaryPage(page);
    expect((await progress(page, id)).cfi).toBe(before.cfi);
    await page.getByRole('button', { name: 'Закрыть книгу', exact: true }).click();
    await expect(page.locator('#reader')).toBeHidden();

    // Reload proves IndexedDB persistence, not only an in-memory return to the same token.
    await page.reload();
    await page.waitForFunction(() => window.glava?.hooks.read);
    expect((await progress(page, id)).cfi).toBe(before.cfi);
    await openBook(page, id);
    await startWords(page);
    await pause(page);
    await expect(word(page)).toHaveAttribute('aria-label', pausedWord);
    expect((await progress(page, id)).word.cfi).toBe(before.word.cfi);
    expect(errors).toEqual([]);
  });
}

test('word rewind, sentence rewind, and mode switches do not count already read pages twice', async ({ page }) => {
  const id = await prepareBook(page);
  await openBook(page, id);
  await selectWordsMode(page, 'Изумрудный');
  await play(page);
  await page.waitForTimeout(5000);
  await pause(page);
  const highWater = await totals(page);
  const highCursor = await progress(page, id);
  expect(highWater.pages).toBeGreaterThan(0);

  await pane(page).getByRole('button', { name: 'Назад на 10 слов', exact: true }).click();
  const rewound = await progress(page, id);
  expect(rewound.cfi).not.toBe(highCursor.cfi);
  expect(rewound.f).toBeLessThan(highCursor.f);
  expect((await totals(page)).pages).toBeCloseTo(highWater.pages, 5);
  await play(page);
  await page.waitForTimeout(500); // Less than ten words: reread only previously credited text.
  await pause(page);
  expect((await totals(page)).pages).toBeCloseTo(highWater.pages, 5);
  await pane(page).getByRole('button', { name: 'К началу предложения', exact: true }).click();
  expect((await totals(page)).pages).toBeCloseTo(highWater.pages, 5);

  await ordinaryPage(page);
  await page.getByRole('button', { name: 'Закрыть книгу', exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => window.glava?.hooks.read);
  await openBook(page, id);
  await startWords(page);
  await pause(page);
  expect((await totals(page)).pages).toBeCloseTo(highWater.pages, 5);
  expect((await progress(page, id)).readMax).toBeGreaterThanOrEqual(rewound.f);
  const resumed = await progress(page, id);
  await play(page);
  await page.waitForTimeout(700);
  await pause(page);
  expect((await progress(page, id)).cfi).not.toBe(resumed.cfi);
  expect((await totals(page)).pages).toBeCloseTo(highWater.pages, 5);
});

test('EPUB continues into the next chapter without crediting the skipped text', async ({ page }) => {
  const id = await prepareBook(page, 'epub');
  await openBook(page, id);
  await selectWordsMode(page, 'Рубежпервой');
  await expect(word(page)).toHaveAttribute('aria-label', /^Рубежпервой/);
  const before = await progress(page, id);
  expect(before.f).toBeGreaterThan(0.2);
  expect((await totals(page)).pages).toBe(0);
  const chapter = await pane(page).locator('.rsvp-chapter').textContent();
  await play(page);
  await expect(pane(page).locator('.rsvp-chapter')).not.toHaveText(chapter);
  await expect(toggle(page)).toBeEnabled();
  await pause(page);
  const after = await progress(page, id);
  expect(after.word.sectionIndex).toBeGreaterThan(before.word.sectionIndex);
  expect((await totals(page)).pages).toBeLessThan(0.3);
  await ordinaryPage(page);
  await page.getByRole('button', { name: 'Закрыть книгу', exact: true }).click();
  await openBook(page, id);
  await startWords(page);
  await pause(page);
  expect((await progress(page, id)).word.sectionIndex).toBe(after.word.sectionIndex);
});

test('keyboard pause and Escape operate on the word mode without closing the book', async ({ page }) => {
  const id = await prepareBook(page);
  await openBook(page, id);
  await startWords(page);
  await pause(page);
  await pane(page).focus();
  await page.keyboard.press('Space');
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Пауза');
  await expect(toggle(page).locator('.rsvp-play-icon')).toBeHidden();
  await expect(toggle(page).locator('.rsvp-pause-icon')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Начать чтение по словам');
  await expect(toggle(page).locator('.rsvp-play-icon')).toBeVisible();
  await expect(toggle(page).locator('.rsvp-pause-icon')).toBeHidden();
  const before = await progress(page, id);
  await page.keyboard.press('Escape');
  await expect(pane(page)).toBeHidden();
  await expect(page.locator('#reader')).toBeVisible();
  expect((await progress(page, id)).cfi).toBe(before.cfi);
});

test('paused and hidden RSVP neither advances words nor accrues reading minutes', async ({ page }) => {
  // All app clocks are installed before startup. Normal asynchronous book loading is allowed
  // to finish before freezing time; advancing 65 seconds exercises the real accounting ticks.
  await page.clock.install();
  const id = await prepareBook(page);
  await openBook(page, id);
  await startWords(page);
  await pause(page);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1000));
  const baseline = await totals(page);

  await play(page);
  await page.clock.runFor(65_000);
  await pause(page);
  const read = await totals(page);
  // Subtract any ordinary reading during startup instead of conflating it with
  // RSVP playback. Every five-second save must retain this 65-second total.
  expect(read.minutes - baseline.minutes).toBeCloseTo(65 / 60, 3);
  expect(read.listening).toBe(0);
  const pausedWord = await shownWord(page);

  await page.clock.runFor(120_000);
  await expect(word(page)).toHaveAttribute('aria-label', pausedWord);
  const paused = await totals(page);
  expect(paused.minutes).toBeCloseTo(read.minutes, 5);
  expect(paused.pages).toBeCloseTo(read.pages, 5);

  await play(page);
  await page.clock.runFor(5000);
  // Playwright's headless focus is platform-dependent; deliver the standard visibility event
  // deterministically and test the production lifecycle handlers and accounting under it.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Начать чтение по словам');
  const hidden = await totals(page);
  expect(hidden.minutes - read.minutes).toBeCloseTo(5 / 60, 3);
  const hiddenWord = await shownWord(page);
  await page.clock.runFor(120_000);
  expect((await totals(page)).minutes).toBeCloseTo(hidden.minutes, 5);
  expect((await totals(page)).pages).toBeCloseTo(hidden.pages, 5);
  await expect(word(page)).toHaveAttribute('aria-label', hiddenWord);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(toggle(page)).toHaveAttribute('aria-label', 'Начать чтение по словам');
});

test('speed and focus controls work, stay inside a narrow phone, and persist on reopening', async ({ page }, testInfo) => {
  const id = await prepareBook(page);
  await openBook(page, id);
  await startWords(page);
  await pause(page);
  const speed = pane(page).getByRole('slider', { name: 'Скорость, слов в минуту', exact: true });
  await speed.evaluate(input => {
    input.value = '360';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(speed).toHaveValue('360');
  await pane(page).locator('summary').click();
  const focus = pane(page).locator('[data-rsvp-setting="focus"]');
  await focus.uncheck();
  await expect(focus).not.toBeChecked();
  await ordinaryPage(page);
  await startWords(page);
  await pause(page);
  await expect(speed).toHaveValue('360');
  await expect(focus).not.toBeChecked();
  await pane(page).locator('summary').click();
  await focus.check();

  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const layout = await pane(page).evaluate(panel => {
    const stage = panel.querySelector('.rsvp-stage').getBoundingClientRect();
    const pivot = panel.querySelector('.rsvp-pivot').getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      pivotCenter: (pivot.left + pivot.right) / 2,
      target: stage.left + stage.width * 0.4,
      panelLeft: panel.getBoundingClientRect().left,
      panelRight: panel.getBoundingClientRect().right,
      viewport: innerWidth,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.panelLeft).toBeGreaterThanOrEqual(-1);
  expect(layout.panelRight).toBeLessThanOrEqual(layout.viewport + 1);
  expect(Math.abs(layout.pivotCenter - layout.target)).toBeLessThanOrEqual(1.5);
  await page.screenshot({ path: testInfo.outputPath('words-320.png'), fullPage: true });
});

test('the shipped service worker caches RSVP and reopens an imported EPUB fully offline', async ({ page, context }) => {
  const id = await prepareBook(page, 'epub');
  // Production auto-registers on HTTPS. localhost is a secure context too, so register the
  // identical worker explicitly rather than changing the application's production condition.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const shellHasWords = await page.evaluate(async () => !!(await caches.match('/js/reader/rsvp.js')));
  expect(shellHasWords).toBe(true);
  await openBook(page, id);
  await selectWordsMode(page, 'Изумрудный');
  await ordinaryPage(page);
  await page.getByRole('button', { name: 'Закрыть книгу', exact: true }).click();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.glava?.hooks.read);
  await openBook(page, id);
  await startWords(page);
  await pause(page);
  await expect(word(page)).toHaveAttribute('aria-label', 'Изумрудный');
  await play(page);
  await expect.poll(() => shownWord(page)).not.toBe('Изумрудный');
  await pause(page);
});
