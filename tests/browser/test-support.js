import { test as base, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// WebKit's private contexts cannot store File/Blob values in IndexedDB.
// A fresh persistent profile exercises the same real storage as normal Safari:
// https://github.com/microsoft/playwright/issues/42795
export const test = base.extend({
  context: async ({
    context: defaultContext, browserName, playwright, launchOptions, headless,
    contextOptions, baseURL, viewport, deviceScaleFactor, locale, timezoneId,
    colorScheme, serviceWorkers,
  }, use) => {
    if (browserName !== 'webkit') {
      await use(defaultContext);
      return;
    }

    const profile = await mkdtemp(join(tmpdir(), 'glava-webkit-'));
    let persistentContext;
    try {
      persistentContext = await playwright.webkit.launchPersistentContext(profile, {
        ...launchOptions,
        ...contextOptions,
        headless, baseURL, viewport, deviceScaleFactor, locale, timezoneId,
        colorScheme, serviceWorkers,
      });
      // Playwright Test records traces and failure screenshots for contexts
      // created through its public API, including persistent contexts.
      await use(persistentContext);
    } finally {
      try {
        await persistentContext?.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    }
  },
  page: async ({ context }, use) => {
    // Persistent contexts start with a page; use it rather than leaving an
    // unrelated blank tab ahead of the tested page in failure snapshots.
    await use(context.pages()[0] || await context.newPage());
  },
});

export { expect };
