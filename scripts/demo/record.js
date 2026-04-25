#!/usr/bin/env node
/**
 * Record a Playwright walkthrough of one app.
 *
 *   node record.js <app>    # app = erp | floor-tech | training
 *
 * Reads:
 *   scenes/<app>.json       — scene list with narration + actions
 *   audio/<app>/durations.json — per-scene mp3 durations (from generate-tts.sh)
 *
 * Writes:
 *   out/<app>-raw.webm      — video of the Playwright session
 *
 * The script waits for each scene's narration duration to keep the video in sync
 * with the audio track that gets muxed in afterward.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.argv[2];
if (!APP) {
  console.error('usage: node record.js <app>');
  process.exit(1);
}

const ROOT = __dirname;
const scenesFile = path.join(ROOT, 'scenes', `${APP}.json`);
const durationsFile = path.join(ROOT, 'audio', APP, 'durations.json');
const outDir = path.join(ROOT, 'out');

if (!fs.existsSync(scenesFile)) throw new Error(`missing ${scenesFile}`);
if (!fs.existsSync(durationsFile)) throw new Error(`missing ${durationsFile} — run generate-tts.sh first`);

const { baseUrl, mockRole, viewport, scenes } = JSON.parse(fs.readFileSync(scenesFile, 'utf8'));
const durations = JSON.parse(fs.readFileSync(durationsFile, 'utf8'));
const durationById = Object.fromEntries(durations.map((d) => [d.id, d.duration]));

fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Inject a visible "hotspot" marker that flashes on each click so viewers can
// see where the action happened. Playwright videos don't show the cursor by default.
const HOTSPOT_JS = `
  if (!window.__ggDemoHotspotInjected) {
    window.__ggDemoHotspotInjected = true;
    const style = document.createElement('style');
    style.textContent = \`
      .__gg_hotspot { position: fixed; z-index: 2147483646; pointer-events: none;
        border: 3px solid #E37125; border-radius: 50%; width: 48px; height: 48px;
        transform: translate(-50%, -50%); animation: __gg_ping 900ms ease-out forwards; }
      @keyframes __gg_ping {
        0% { opacity: 1; transform: translate(-50%, -50%) scale(0.4); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
      }
    \`;
    document.head.appendChild(style);
    window.__ggFlash = (x, y) => {
      const d = document.createElement('div');
      d.className = '__gg_hotspot';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 900);
    };
  }
`;

async function flashAt(page, selector, first = false) {
  try {
    const el = first ? page.locator(selector).first() : page.locator(selector);
    const box = await el.boundingBox({ timeout: 3000 });
    if (box) {
      await page.evaluate(({ x, y }) => window.__ggFlash && window.__ggFlash(x, y), {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
    }
  } catch {
    // non-fatal
  }
}

async function runAction(page, action) {
  switch (action.type) {
    case 'goto':
      await page.goto(baseUrl + action.path, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: HOTSPOT_JS }).catch(() => {});
      break;
    case 'wait':
      await sleep(action.ms);
      break;
    case 'click':
      await page.addScriptTag({ content: HOTSPOT_JS }).catch(() => {});
      await flashAt(page, action.selector);
      await sleep(300);
      await page.locator(action.selector).first().click({ timeout: 5000 }).catch((err) => {
        console.warn(`  click failed for ${action.selector}: ${err.message.split('\n')[0]}`);
      });
      break;
    case 'clickFirst':
      await page.addScriptTag({ content: HOTSPOT_JS }).catch(() => {});
      await flashAt(page, action.selector, true);
      await sleep(300);
      await page.locator(action.selector).first().click({ timeout: 5000 }).catch((err) => {
        console.warn(`  clickFirst failed for ${action.selector}: ${err.message.split('\n')[0]}`);
      });
      break;
    default:
      console.warn('unknown action type', action.type);
  }
}

(async () => {
  console.log(`[${APP}] launching browser at ${viewport.width}x${viewport.height}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: outDir, size: viewport },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Seed localStorage before any navigation so mock mode picks up the role.
  await context.addInitScript((role) => {
    try { localStorage.setItem('gg_erp_mock_role', role); } catch {}
  }, mockRole);

  let totalSoFar = 0;
  for (const scene of scenes) {
    const target = durationById[scene.id];
    if (!target) throw new Error(`no duration for scene ${scene.id}`);
    const start = Date.now();
    console.log(`[${APP}] scene ${scene.id} (${target.toFixed(2)}s)`);
    for (const action of scene.actions || []) {
      await runAction(page, action);
    }
    // Pad the scene to match the audio duration so video stays in sync.
    const spent = (Date.now() - start) / 1000;
    const remaining = target - spent;
    if (remaining > 0) await sleep(remaining * 1000);
    totalSoFar += target;
  }

  console.log(`[${APP}] done — total ${totalSoFar.toFixed(1)}s. Closing context…`);
  await context.close(); // triggers video finalization
  const videoPath = await page.video().path();
  const finalPath = path.join(outDir, `${APP}-raw.webm`);
  fs.renameSync(videoPath, finalPath);
  console.log(`[${APP}] video saved to ${finalPath}`);
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
