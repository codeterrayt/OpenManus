import { EventEmitter } from 'events';
import { config } from '../config.js';
import os from 'os';
import path from 'path';

// Boost this Node.js process to high priority so Windows doesn't deprioritize it
try {
  os.setPriority(0, os.constants.priority.PRIORITY_HIGH);
  console.log('[Browser] Process priority set to HIGH.');
} catch (e) {
  console.warn('[Browser] Could not set process priority:', e.message);
}

// ─── Persistent browser singleton ────────────────────────────────────────────

export const browserEvents = new EventEmitter();

let _browser = null;
let _page    = null;
let _cdpSession = null;
let _windowRestored = false; // restore minimized window once per browser session
let _keepAliveInterval = null; // periodic heartbeat to prevent background suspension

// Current screencast quality settings (adaptive — client can request changes)
let _screencastQuality = 35;  // JPEG quality: 35 is visually good, smaller than 50
let _screencastFps     = 20;  // target FPS

async function getBrowser() {
  if (_browser) {
    try {
      await _browser.version();
      return _browser;
    } catch {
      console.log('[Browser] Previous browser died, relaunching...');
      _browser = null;
      _page    = null;
      _cdpSession = null;
    }
  }

  console.log('[Browser] Launching CloakBrowser stealth Chromium (first call may take ~30s to download binary)...');

  const { launch } = await import('cloakbrowser/puppeteer');

  _browser = await launch({
    headless: config.browser.headless,
    humanize: true,          // Bézier mouse curves, per-character typing, realistic scroll
    launchOptions: {
      defaultViewport: { width: 1280, height: 800 },
      args: [
        // Window state
        '--start-maximized',
        '--window-size=1280,800',

        // ── Background throttling prevention ──────────────────────────────
        // These flags tell Chromium NOT to throttle timers, animations,
        // rendering or networking when the window is hidden / not focused.
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-gpu-backgrounding',
        '--disable-background-networking',
        '--disable-ipc-flooding-protection',
        '--disable-hang-monitor',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees,site-per-process',
        '--enable-features=NetworkService,NetworkServiceLogging',
        '--force-fieldtrials=*BackgroundTracing/default/',
        '--run-all-compositor-stages-before-draw',

        // ── Render even when not visible ──────────────────────────────────
        // Prevents Chromium from skipping paint/layout when window is
        // minimized or occluded by other windows.
        '--disable-gpu',         // use software renderer — always active regardless of visibility
        '--use-gl=swiftshader',  // software GL that works with no display

        // Misc stability
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update',
        '--password-store=basic',
        '--disable-notifications',
        '--deny-permission-prompts',
      ],
    },
  });

  _browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const newPage = await target.page().catch(() => null);
      if (newPage) {
        try {
          const pages = await _browser.pages().catch(() => []);
          if (pages.length > 1) {
            const redirectIfValid = async (url) => {
              if (url && url !== 'about:blank' && _page) {
                console.log(`[Browser] Redirecting main tab to new tab URL: ${url}`);
                _page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
                await newPage.close().catch(() => {});
                return true;
              }
              return false;
            };

            const initialUrl = newPage.url();
            if (await redirectIfValid(initialUrl)) {
              return;
            }

            // If it starts as about:blank, listen for frame navigation
            const frameNavigatedHandler = async (frame) => {
              if (frame === newPage.mainFrame()) {
                const navUrl = newPage.url();
                if (navUrl && navUrl !== 'about:blank') {
                  newPage.off('framenavigated', frameNavigatedHandler);
                  await redirectIfValid(navUrl);
                }
              }
            };
            newPage.on('framenavigated', frameNavigatedHandler);

            // Timeout fallback to prevent leaking pages
            setTimeout(async () => {
              try {
                const pagesNow = await _browser.pages().catch(() => []);
                if (pagesNow.includes(newPage)) {
                  newPage.off('framenavigated', frameNavigatedHandler);
                  const finalUrl = newPage.url();
                  if (finalUrl && finalUrl !== 'about:blank' && _page) {
                    console.log(`[Browser] Timeout redirect to: ${finalUrl}`);
                    _page.goto(finalUrl, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
                  }
                  await newPage.close().catch(() => {});
                }
              } catch {}
            }, 4000);
          }
        } catch (e) {
          console.warn('[Browser] Target created redirection error:', e.message);
          await newPage.close().catch(() => {});
        }
      }
    }
  });

  _browser.on('disconnected', () => {
    console.log('[Browser] CloakBrowser disconnected — will relaunch on next call.');
    _browser = null;
    _page    = null;
    _windowRestored = false;
    stopKeepAlive();
  });

  console.log('[Browser] CloakBrowser ready.');
  return _browser;
}

async function ensureScreencastActive(page) {
  if (_cdpSession) {
    return;
  }
  try {
    console.log('[Browser] Initializing CDP session for screencasting...');
    const session = await page.target().createCDPSession();
    _cdpSession = session;

    // Configure silent downloads to the local downloads folder
    await session.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: path.resolve('./downloads')
    }).catch((err) => {
      console.warn('[Browser] Could not set download behavior:', err.message);
    });

    session.on('disconnected', () => {
      console.log('[Browser] CDP session disconnected.');
      if (_cdpSession === session) {
        _cdpSession = null;
      }
      browserEvents.emit('close');
    });

    // ── Emulate permanent page focus ─────────────────────────────────────
    // Makes the page think it always has focus even when the OS window is
    // minimized or another app is in front. Prevents requestAnimationFrame
    // stalls, timer throttling, and visibility-based JS pauses.
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

    // Force the page lifecycle to 'active' state (overrides background/hidden)
    await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

    // Enable DOM activity to prevent idle detection
    await session.send('Target.activateTarget', {
      targetId: page.target()._targetId
    }).catch(() => {});

    // Emit loading/loaded lifecycle events so the UI can show a spinner
    session.on('Page.frameStartedLoading', ({ frameId }) => {
      // Only fire for the main frame (no subframe iframes)
      page.mainFrame()._id === frameId && browserEvents.emit('loading');
    });
    session.on('Page.frameStoppedLoading', ({ frameId }) => {
      page.mainFrame()._id === frameId && browserEvents.emit('loaded');
    });

    await session.send('Page.startScreencast', {
      format: 'jpeg',
      quality: _screencastQuality,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
      maxFramesPerSecond: _screencastFps,
    });

    session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      browserEvents.emit('frame', {
        data,
        metadata,
        url: page.url(),
      });
      session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });

    console.log('[Browser] CDP screencast started.');

    // Start keep-alive heartbeat after screencast is set up
    startKeepAlive(page, session);

  } catch (err) {
    console.warn('[Browser] Failed to initialize CDP screencasting:', err.message);
    _cdpSession = null;
  }
}

// ── Keep-Alive Heartbeat ──────────────────────────────────────────────────────
// Every 4 seconds:
//   1. Re-assert focus emulation (some navigations reset it)
//   2. Re-assert active lifecycle
//   3. Restore window if it was minimized by the user or OS
// This ensures the browser NEVER throttles regardless of visibility.
function startKeepAlive(page, session) {
  stopKeepAlive(); // clear any existing interval

  _keepAliveInterval = setInterval(async () => {
    if (!session || !_cdpSession) return;
    try {
      // Re-emulate focus (navigations can clear this)
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

      // Restore minimized window so OS renders its contents
      await restoreBrowserWindow();

      // Nudge the page with a no-op evaluate to prevent idle suspension
      await page.evaluate(() => void 0).catch(() => {});
    } catch {}
  }, 4000);

  console.log('[Browser] Keep-alive heartbeat started (4s interval).');
}

function stopKeepAlive() {
  if (_keepAliveInterval) {
    clearInterval(_keepAliveInterval);
    _keepAliveInterval = null;
    console.log('[Browser] Keep-alive heartbeat stopped.');
  }
}

/**
 * Adaptive quality control — called by the frontend when it measures high latency.
 * Restarts the screencast with new JPEG quality and FPS settings.
 * quality: 20-60 (lower = smaller files, faster)
 * fps: 10-25
 */
export async function setScreencastQuality(quality, fps) {
  quality = Math.max(15, Math.min(70, quality || _screencastQuality));
  fps     = Math.max(5,  Math.min(25, fps     || _screencastFps));

  if (quality === _screencastQuality && fps === _screencastFps) return;
  _screencastQuality = quality;
  _screencastFps     = fps;

  if (!_cdpSession) return;
  console.log(`[Browser] Adaptive quality: JPEG=${quality} FPS=${fps}`);
  try {
    await _cdpSession.send('Page.stopScreencast').catch(() => {});
    await _cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: _screencastQuality,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
      maxFramesPerSecond: _screencastFps,
    });
  } catch (err) {
    console.warn('[Browser] Failed to update screencast quality:', err.message);
  }
}

async function getPage() {
  const browser = await getBrowser();

  if (_page) {
    try {
      await _page.title();
      await ensureScreencastActive(_page);
      return _page;
    } catch {
      _page = null;
      _cdpSession = null;
    }
  }

  // Reuse existing page if available, else open new tab
  const pages = await browser.pages();
  _page = pages.length > 0 ? pages[0] : await browser.newPage();

  // CloakBrowser provides a realistic UA automatically, but we set one explicitly
  // just in case headless mode changes anything
  await _page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  );

  // Intercept window.open, link target clicks, and form submissions to force same-tab navigation
  await _page.evaluateOnNewDocument(() => {
    window.open = function(url) {
      if (url) window.location.href = url;
      return window;
    };
    document.addEventListener('click', (e) => {
      const link = e.target?.closest?.('a');
      if (link && link.target && link.target !== '_self') {
        link.target = '_self';
      }
    }, true);
    document.addEventListener('submit', (e) => {
      const form = e.target?.closest?.('form');
      if (form && form.target && form.target !== '_self') {
        form.target = '_self';
      }
    }, true);
  }).catch(() => {});

  await ensureScreencastActive(_page);

  return _page;
}

/** Retrieve current URL, Title, and visible page text if browser is active. */
export async function getActiveBrowserState() {
  if (!_browser || !_page) return null;
  try {
    const title = await _page.title().catch(() => '');
    const url = _page.url();
    const bodyText = await _page.evaluate(() => {
      // Avoid modifying page directly, clone body
      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll('script,style,noscript,nav,footer,aside').forEach(el => el.remove());
      return bodyClone.innerText ?? '';
    }).catch(() => '');

    const cleaned = bodyText.replace(/\s{2,}/g, '\n').trim().slice(0, 10000);
    return {
      url,
      title,
      text: cleaned || '[No visible text content found]'
    };
  } catch (err) {
    return null;
  }
}

/** Explicitly shut down the persistent browser (e.g. on session end). */
export async function closeBrowser() {
  _cdpSession = null;
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    _page    = null;
    console.log('[Browser] CloakBrowser closed.');
    browserEvents.emit('close');
  }
}

async function restoreBrowserWindow() {
  if (!_cdpSession) return;
  try {
    const { windowId } = await _cdpSession.send('Browser.getWindowForTarget');
    if (!windowId) return;
    const { bounds } = await _cdpSession.send('Browser.getWindowBounds', { windowId });
    if (bounds && bounds.windowState === 'minimized') {
      // Minimized = OS completely suspends rendering. Force back to normal.
      console.log('[Browser] Restoring minimized Chromium window...');
      await _cdpSession.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: 'normal', width: 1280, height: 820 }
      });
    }
    // Always re-assert normal bounds to force a compositor frame even if not minimized.
    // This beats the "occluded window" rendering suspension on Windows.
    await _cdpSession.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' }
    });
  } catch {
    // Ignore window state errors (headless mode has no window)
  }
}

export async function handleUserAction(action) {
  const page = await getPage().catch(() => null);
  if (!page) {
    console.log('[Browser] handleUserAction: No active page.');
    return;
  }

  const { type } = action;
  await ensureScreencastActive(page);

  // Restore minimized window only once per session (not on every action)
  if (!_windowRestored) {
    _windowRestored = true;
    await restoreBrowserWindow().catch(() => {});
    await page.bringToFront().catch(() => {});
  }

  // For navigation actions, bring the tab to front
  if (type === 'navigate' || type === 'back' || type === 'forward' || type === 'reload') {
    await page.bringToFront().catch(() => {});
  }

  // NOTE: Do NOT call page.focus('body') here — it steals focus from whatever
  // element the user clicked on (e.g. an input field), breaking text entry.

  try {
    if (type === 'viewport') {
      const { width, height } = action;
      await page.setViewport({ width: width || 1280, height: height || 800 });

    } else if (type === 'mousedown') {
      const { x, y, button } = action;
      if (x != null && y != null) {
        await page.mouse.move(x, y);
      }
      await page.mouse.down({ button: button || 'left' });

    } else if (type === 'mouseup') {
      const { x, y, button } = action;
      if (x != null && y != null) {
        await page.mouse.move(x, y);
      }
      await page.mouse.up({ button: button || 'left' });

    } else if (type === 'mousemove') {
      const { x, y } = action;
      if (x != null && y != null) {
        await page.mouse.move(x, y);
      }

    } else if (type === 'wheel') {
      const { deltaX, deltaY, x, y } = action;
      // Move to the cursor position before scrolling so the right element receives it
      if (x != null && y != null) {
        await page.mouse.move(x, y);
      }
      await page.mouse.wheel({ deltaX: deltaX || 0, deltaY: deltaY || 0 }).catch(async () => {
        await page.evaluate((dx, dy) => window.scrollBy(dx, dy), deltaX || 0, deltaY || 0);
      });

    } else if (type === 'keydown') {
      const { key } = action;

      // Modifier keys: hold them down so combos (Ctrl+A, Shift+Click) work
      const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);
      if (MODIFIERS.has(key)) {
        await page.keyboard.down(key);

      // Single printable character: use keyboard.type() which fires
      // keydown → keypress → INPUT → keyup — the 'input' event is what
      // actually inserts text into <input> / contenteditable fields.
      } else if (key.length === 1) {
        await page.keyboard.type(key, { delay: 0 });

      // Special keys (Enter, Backspace, Arrow*, Tab, Delete, etc.):
      // use keyboard.press() which fires the full keydown+keypress+keyup cycle.
      } else {
        await page.keyboard.press(key).catch(async () => {
          // Fallback for unknown key names — try raw down
          await page.keyboard.down(key).catch(() => {});
        });
      }

    } else if (type === 'keyup') {
      const { key } = action;
      // Only send keyup for modifier keys; printable chars and special keys
      // are already fully handled by type() and press() above.
      const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);
      if (MODIFIERS.has(key)) {
        await page.keyboard.up(key);
      }

    } else if (type === 'keypress') {
      const { key } = action;
      await page.keyboard.press(key);

    } else if (type === 'type') {
      const { text } = action;
      await page.keyboard.type(text);

    } else if (type === 'navigate') {
      const { url } = action;
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 45_000 });

    } else if (type === 'back') {
      await page.goBack().catch(() => {});

    } else if (type === 'forward') {
      await page.goForward().catch(() => {});

    } else if (type === 'reload') {
      await page.reload().catch(() => {});
    }
  } catch (err) {
    console.warn('[Browser] Error dispatching user action:', type, err.message);
  }
}

// ─── Public tool ─────────────────────────────────────────────────────────────

/**
 * Uses the persistent stealth CloakBrowser to navigate and interact.
 * Passes Cloudflare, FingerprintJS, reCAPTCHA v3, and 30+ other bot detectors.
 * Browser stays open between calls — JS state, cookies, login sessions preserved.
 *
 * @param {object} params
 * @param {string}   params.url            - URL to visit
 * @param {string}   [params.instructions] - What to look for / do on the page
 * @param {string}   [params.action]       - 'extract_text' | 'screenshot' | 'click' | 'type' | 'evaluate'
 * @param {string}   [params.selector]     - CSS selector for click/type actions
 * @param {string}   [params.value]        - Text to type (for 'type' action)
 */
export async function browseWeb({ url = null, instructions = '', action = 'extract_text', selector = '', value = '' }) {
  const page = await getPage();
  const currentUrl = page.url();

  // Determine target URL
  let target = null;
  if (url) {
    target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  } else if (currentUrl && currentUrl !== 'about:blank') {
    target = currentUrl;
  }

  if (target) {
    console.log(`[Browser] → ${action} on ${target}`);
    const targetBase = target.split('?')[0].split('#')[0];
    const currentBase = currentUrl.split('?')[0].split('#')[0];

    if (currentBase !== targetBase && currentUrl !== 'about:blank') {
      console.log(`[Browser] Navigating: ${currentUrl} → ${target}`);
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 45_000 });
      await ensureScreencastActive(page);
      await new Promise(r => setTimeout(r, 1000));
    } else if (currentUrl === 'about:blank' && url) {
      console.log(`[Browser] Navigating from blank to: ${target}`);
      await page.goto(target, { waitUntil: 'networkidle2', timeout: 45_000 });
      await ensureScreencastActive(page);
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log('[Browser] Already on target URL or using current page state.');
    }
  } else {
    console.log(`[Browser] → ${action} on current page (about:blank)`);
  }

  // ── Screenshot ────────────────────────────────────────────────────────────
  if (action === 'screenshot') {
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    return {
      text: `Screenshot captured: ${page.url()}`,
      screenshotBase64: buf.toString('base64'),
    };
  }

  // ── Click element by selector (CSS or XPath) or text ─────────────────────
  if (action === 'click') {
    try {
      if (selector) {
        if (selector.startsWith('/') || selector.startsWith('(')) {
          // XPath selector — resolve via page.$x()
          const [el] = await page.$x(selector);
          if (el) {
            await el.click();
          } else {
            // Fallback: use evaluate to click via XPath
            const clicked = await page.evaluate((xpath) => {
              const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              if (result.singleNodeValue) {
                // Cast to HTMLElement to click it
                result.singleNodeValue.click();
                return true;
              }
              return false;
            }, selector);
            if (!clicked) {
              throw new Error(`XPath element not found: ${selector}`);
            }
          }
        } else {
          // CSS selector
          await page.waitForSelector(selector, { timeout: 3000 });
          await page.click(selector);
        }
      } else if (instructions) {
        // Fallback: match by text content
        const clicked = await page.evaluate((hint) => {
          const els = [...document.querySelectorAll('a,button,[role="button"],input[type="submit"],select,label,[tabindex],div,span')];
          const match = els.find(el =>
            el.textContent?.trim().toLowerCase().includes(hint.toLowerCase()) ||
            el.getAttribute('aria-label')?.toLowerCase().includes(hint.toLowerCase()) ||
            el.getAttribute('placeholder')?.toLowerCase().includes(hint.toLowerCase()) ||
            el.getAttribute('value')?.toLowerCase().includes(hint.toLowerCase())
          );
          if (match) {
            match.click();
            return true;
          }
          return false;
        }, instructions);
        if (!clicked) {
          throw new Error(`No clickable element found matching text "${instructions}"`);
        }
      } else {
        throw new Error('Click action requires either a selector or text instructions.');
      }
      await new Promise(r => setTimeout(r, 1000));
      return { text: `Successfully clicked: ${selector || instructions}. Current URL: ${page.url()}` };
    } catch (clickErr) {
      console.warn('[Browser] Click error:', clickErr.message);
      return { error: `Click failed: ${clickErr.message}` };
    }
  }

  // ── Type text into an input ─────────────────────────────────────────────────
  if (action === 'type') {
    if (!selector) {
      return { error: 'Type action requires a selector.' };
    }
    if (value === undefined) {
      return { error: 'Type action requires a value to type.' };
    }
    try {
      let inputEl;
      if (selector.startsWith('/') || selector.startsWith('(')) {
        // XPath — resolve then focus
        const [el] = await page.$x(selector);
        inputEl = el;
        if (el) {
          await el.focus();
        } else {
          throw new Error(`XPath input element not found: ${selector}`);
        }
      } else {
        await page.waitForSelector(selector, { timeout: 3000 });
        inputEl = await page.$(selector);
        if (!inputEl) {
          throw new Error(`CSS input element not found: ${selector}`);
        }
        await page.focus(selector);
      }
      // Clear existing value first
      if (inputEl) {
        await inputEl.click({ clickCount: 3 }); // triple-click to select all
        await page.keyboard.press('Backspace');
      }
      await page.keyboard.type(value, { delay: 40 });
      return { text: `Successfully typed "${value}" into ${selector}` };
    } catch (typeErr) {
      console.warn('[Browser] Type error:', typeErr.message);
      return { error: `Type failed: ${typeErr.message}` };
    }
  }

  // ── Evaluate arbitrary JS (state preserved across calls) ──────────────────
  if (action === 'evaluate' && instructions) {
    try {
      // eslint-disable-next-line no-new-func
      const evalResult = await page.evaluate(new Function(`return (async () => { ${instructions} })()`));
      return { text: `Eval result: ${JSON.stringify(evalResult)}` };
    } catch (err) {
      console.warn('[Browser] Eval error:', err.message);
      return { error: `Eval failed: ${err.message}` };
    }
  }

  // ── Extract text (default) ─────────────────────────────────────────────────
  const title = await page.title().catch(() => '');
  const bodyText = await page.evaluate(() => {
    document.querySelectorAll('script,style,noscript,nav,footer,aside').forEach(el => el.remove());
    return document.body?.innerText ?? '';
  }).catch(() => '');

  const cleaned = bodyText.replace(/\s{2,}/g, '\n').trim().slice(0, 10_000);

  const result = [
    `URL: ${page.url()}`,
    `Title: ${title || '(no title)'}`,
    '',
    cleaned || '[No visible text content found]',
    instructions ? `\n[Task: ${instructions}]` : '',
  ].join('\n').trim();

  return { text: result };
}

/**
 * Retrieves the full page HTML or search-based HTML snippets matching a specific query string.
 * Each match includes the element's tag name, ID, classes, XPath, and outerHTML snippet.
 *
 * @param {object} params
 * @param {string} [params.query] - The text or attribute value to query. If omitted, returns the page's body HTML content.
 */
export async function inspectPageHtml({ query = null }) {
  const page = await getPage().catch(() => null);
  if (!page) {
    return { error: 'No active browser session or page found.' };
  }

  const title = await page.title().catch(() => '');
  const url = page.url();

  if (!query) {
    const html = await page.content().catch(() => '');
    return {
      url,
      title,
      html: html.slice(0, 50000) // cap to protect context window size
    };
  }

  const results = await page.evaluate((q) => {
    function getXPath(element) {
      if (element.id) {
        return `//*[@id="${element.id}"]`;
      }
      if (element === document.body) {
        return '/html/body';
      }
      let ix = 0;
      const siblings = element.parentNode ? element.parentNode.childNodes : [];
      for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
          return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
        }
        if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
          ix++;
        }
      }
      return '';
    }

    function getCssSelector(el) {
      // Build a unique CSS selector for this element
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = [];
      let current = el;
      while (current && current !== document.body) {
        let part = current.tagName.toLowerCase();
        if (current.id) { part = `#${CSS.escape(current.id)}`; parts.unshift(part); break; }
        const siblings = Array.from(current.parentNode?.children || []).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          part += `:nth-of-type(${idx})`;
        }
        parts.unshift(part);
        current = current.parentNode;
      }
      return parts.join(' > ');
    }

    const elements = Array.from(document.querySelectorAll('*'));
    const matches = [];

    for (const el of elements) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'HTML', 'BODY'].includes(el.tagName)) continue;

      let matched = false;
      let directText = '';
      for (const child of el.childNodes) {
        if (child.nodeType === 3) directText += child.nodeValue;
      }

      if (directText.toLowerCase().includes(q.toLowerCase())) {
        matched = true;
      } else {
        const attrsToCheck = ['id', 'class', 'name', 'placeholder', 'value', 'href', 'title', 'aria-label', 'data-testid', 'data-id', 'type'];
        for (const attr of attrsToCheck) {
          const val = el.getAttribute(attr);
          if (val && val.toLowerCase().includes(q.toLowerCase())) { matched = true; break; }
        }
      }

      if (matched) {
        const clone = el.cloneNode(true);
        if (clone.children.length > 3) {
          while (clone.children.length > 3) clone.removeChild(clone.lastElementChild);
          const ph = document.createElement('span');
          ph.innerText = '...[truncated]';
          clone.appendChild(ph);
        }
        const style = window.getComputedStyle(el);
        const rect  = el.getBoundingClientRect();
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0;

        matches.push({
          tagName:     el.tagName.toLowerCase(),
          id:          el.getAttribute('id') || null,
          classes:     el.getAttribute('class') || null,
          name:        el.getAttribute('name') || null,
          type:        el.getAttribute('type') || null,
          placeholder: el.getAttribute('placeholder') || null,
          ariaLabel:   el.getAttribute('aria-label') || null,
          xpath:       getXPath(el),
          cssSelector: getCssSelector(el),
          isVisible,
          isEnabled:   !el.disabled,
          inputValue:  ('value' in el) ? el.value : null,
          outerHTML:   clone.outerHTML.slice(0, 800),
        });
      }
    }

    return matches.slice(0, 10);
  }, query);

  return {
    url,
    title,
    query,
    matches: results
  };
}


