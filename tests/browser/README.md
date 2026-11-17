# Reader integration checks

Run the complete reader suite with:

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium webkit
npm run test:unit
npm run test:browser
```

`playwright.config.js` starts the local HTTP server. Tests use the existing
`window.glava` hook, which the application exposes only on `localhost`, to import
the synthetic fixtures. Selection, playback, controls, and transitions then use
the real application and the actual Foliate EPUB/FB2 documents.

The suite checks:

- EPUB and FB2 import, native text selection, sequential playback, and exact word
  and CFI persistence through ordinary mode, closing the book, and a page reload.
- Rewinding and rereading already credited text without counting pages twice,
  including after closing the book and reloading the application.
- Automatic EPUB chapter transitions without crediting a navigation jump as reading.
- Keyboard pause, matching play/pause icons, and return to the ordinary page
  without closing the book.
- Reading time during playback and no additional time or pages during pause or
  background visibility, with deterministic Playwright clock advancement.
- Speed and focus settings, the fixed focus position, and narrow phone layout.
- Registration of the production service worker, the presence of the RSVP module
  in its cache, and reading an imported EPUB after an offline page reload.

The accompanying model tests compare frequent saves with a single batch: short
word exposures must retain fractional pages, five-second autosaves must not
inflate reading minutes, and listening remains a subset of total reading time.

The visibility test dispatches the browser visibility lifecycle event with a
controlled `document.hidden` value because headless window focus is not portable.
It verifies the production lifecycle handlers and statistics, but does not replace
a physical iPhone test of app switching, screen locking, and browser suspension.
Likewise, Playwright WebKit is useful coverage but is not an iOS device emulator.

Production registers its service worker automatically on HTTPS. For the local
test origin, the test explicitly registers the same `sw.js`; `localhost` is a
secure context. It does not change or mock the worker's fetch/cache implementation.

Fixtures contain original test prose only. `npm run test:browser` regenerates both
books deterministically before Playwright starts, locally and in GitHub Actions.
The binary EPUB is generated rather than stored in Git. To regenerate manually:

```sh
python3 tests/browser/fixtures/create-fixtures.py
```

GitHub Actions runs both browsers on pull requests and pushes to `main` or `feat/**`.
It uploads the HTML report, failure traces, and screenshots. Tests do not retry, so
an intermittent failure remains visible instead of being counted as a clean run.

The current local executor can refuse Chromium's startup socket before the first
page opens. If this occurs, report the local browser check as blocked and use the
normal CI runner; do not report the test listing or a syntax check as browser PASS.
