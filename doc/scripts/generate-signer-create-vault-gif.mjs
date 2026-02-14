import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import gifenc from 'gifenc';
import pngjs from 'pngjs';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const { PNG } = pngjs;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const outputGif = path.resolve(repoRoot, 'doc', 'signer-create-vault.gif');
const framesDir = path.resolve(repoRoot, 'doc', '.tmp-signer-gif-frames');
const screenshotsDir = path.resolve(repoRoot, 'screenshots');
const userDataDir = path.resolve(repoRoot, 'doc', '.tmp-signer-gif-profile');
const extensionDistPath = path.resolve(repoRoot, 'dist', 'extension');
const extensionManifestPath = path.resolve(extensionDistPath, 'manifest.json');
const frameDelayMs = Number(process.env.DEMO_FRAME_DELAY_MS || 400);
const outputWidth = Number(process.env.DEMO_WIDTH || 600);
const outputHeight = Number(process.env.DEMO_HEIGHT || 820);

const ensureCleanDir = (dirPath) => {
  rmSync(dirPath, { recursive: true, force: true });
  mkdirSync(dirPath, { recursive: true });
};

const ensureDir = (dirPath) => {
  mkdirSync(dirPath, { recursive: true });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const visibleLocator = async (locators) => {
  for (const locator of locators) {
    if (await locator.count()) {
      const first = locator.first();
      if (await first.isVisible()) {
        return first;
      }
    }
  }
  return null;
};

const clickByText = async (page, values) => {
  for (const value of values) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^\\s*${escaped}\\s*$`, 'i');
    const locator = await visibleLocator([
      page.getByRole('button', { name: regex }),
      page.getByRole('link', { name: regex }),
      page.locator(`button:has-text("${value}")`),
      page.locator(`[role="button"]:has-text("${value}")`),
      page.locator(`a:has-text("${value}")`),
      page.locator(`mat-card:has-text("${value}")`)
    ]);

    if (locator) {
      await locator.click({ timeout: 2000 });
      await sleep(600);
      return true;
    }
  }
  return false;
};

const fillVisiblePasswordFields = async (page, password) => {
  const fields = page.locator('input[type="password"]');
  const count = await fields.count();
  let filled = 0;

  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    if (await field.isVisible()) {
      await field.fill(password);
      filled += 1;
    }
  }

  return filled;
};

const resizeNearest = (sourceData, sourceWidth, sourceHeight, targetWidthValue, targetHeightValue) => {
  if (sourceWidth === targetWidthValue && sourceHeight === targetHeightValue) {
    return sourceData;
  }

  const result = new Uint8Array(targetWidthValue * targetHeightValue * 4);

  for (let y = 0; y < targetHeightValue; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / targetHeightValue) * sourceHeight));
    for (let x = 0; x < targetWidthValue; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / targetWidthValue) * sourceWidth));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (y * targetWidthValue + x) * 4;

      result[targetOffset] = sourceData[sourceOffset];
      result[targetOffset + 1] = sourceData[sourceOffset + 1];
      result[targetOffset + 2] = sourceData[sourceOffset + 2];
      result[targetOffset + 3] = sourceData[sourceOffset + 3];
    }
  }

  return result;
};

const writeNormalizedPng = (png, outputPath) => {
  const normalizedData = resizeNearest(png.data, png.width, png.height, outputWidth, outputHeight);
  const normalized = new PNG({ width: outputWidth, height: outputHeight });
  normalized.data = Buffer.from(normalizedData);
  writeFileSync(outputPath, PNG.sync.write(normalized));
};

const captureAppSurfacePng = async (page) => {
  const candidates = [
    page.locator('app-root'),
    page.locator('body > app-root'),
    page.locator('mat-sidenav-container'),
    page.locator('body > *:first-child')
  ];

  for (const locator of candidates) {
    if (await locator.count()) {
      const element = locator.first();
      if (await element.isVisible()) {
        const box = await element.boundingBox();
        if (box && box.width > 40 && box.height > 40) {
          const buffer = await element.screenshot();
          return PNG.sync.read(buffer);
        }
      }
    }
  }

  const fallback = await page.screenshot({ fullPage: false });
  return PNG.sync.read(fallback);
};

const saveFrame = async (page, index, hold = 1) => {
  const target = path.resolve(framesDir, `frame-${String(index).padStart(3, '0')}.png`);
  const surface = await captureAppSurfacePng(page);
  writeNormalizedPng(surface, target);

  for (let i = 1; i < hold; i += 1) {
    const duplicate = path.resolve(framesDir, `frame-${String(index + i).padStart(3, '0')}.png`);
    copyFileSync(target, duplicate);
  }
};

const saveMarketingScreenshot = async (page, fileName) => {
  ensureDir(screenshotsDir);
  const target = path.resolve(screenshotsDir, fileName);
  const surface = await captureAppSurfacePng(page);
  writeNormalizedPng(surface, target);
};

const gotoRoute = async (page, routePath) => {
  await page.evaluate((route) => {
    window.location.hash = route;
  }, routePath);
  await page.waitForLoadState('networkidle');
  await sleep(900);
};

const clickFirstAccountFromDashboard = async (page) => {
  const candidates = [
    page.locator('mat-tab-body-active a[mat-list-item]').filter({ has: page.locator('app-account-icon') }),
    page.locator('.mat-mdc-list-item').filter({ has: page.locator('app-account-icon') }),
    page.locator('a[mat-list-item]').filter({ has: page.locator('app-account-icon') })
  ];

  for (const locator of candidates) {
    const count = await locator.count();
    if (count > 0) {
      await locator.first().click();
      await page.waitForLoadState('networkidle');
      await sleep(1000);
      return true;
    }
  }

  return false;
};

const readExtensionPopupPath = () => {
  if (!existsSync(extensionManifestPath)) {
    throw new Error('Missing dist/extension/manifest.json. Build the extension first with npm run build:production.');
  }

  const manifest = JSON.parse(readFileSync(extensionManifestPath, 'utf8'));
  const popupPath = manifest?.action?.default_popup;
  if (!popupPath) {
    throw new Error('Could not find action.default_popup in dist/extension/manifest.json.');
  }
  return popupPath;
};

const normalizePathForCompare = (value) => value.replaceAll('\\', '/').toLowerCase();

const getExtensionIdFromPreferences = async () => {
  const preferencesPath = path.resolve(userDataDir, 'Default', 'Preferences');
  const expectedPath = normalizePathForCompare(extensionDistPath);
  const started = Date.now();

  while (Date.now() - started < 30000) {
    if (existsSync(preferencesPath)) {
      try {
        const preferences = JSON.parse(readFileSync(preferencesPath, 'utf8'));
        const settings = preferences?.extensions?.settings ?? {};

        for (const [id, details] of Object.entries(settings)) {
          const extensionPath = details?.path;
          if (typeof extensionPath !== 'string') {
            continue;
          }

          const normalized = normalizePathForCompare(path.resolve(extensionPath));
          if (normalized === expectedPath) {
            return id;
          }
        }
      } catch {
      }
    }

    await sleep(500);
  }

  return null;
};

const getExtensionId = async (context) => {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    try {
      serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch {
    }
  }

  let extensionId = null;
  if (serviceWorker) {
    const serviceWorkerUrl = serviceWorker.url();
    extensionId = serviceWorkerUrl.split('/')[2] ?? null;
  }

  if (!extensionId) {
    extensionId = await getExtensionIdFromPreferences();
  }

  if (!extensionId) {
    throw new Error('Unable to determine extension id from service worker or Chromium Preferences.');
  }

  return extensionId;
};

const encodeGif = () => {
  const frameFiles = readdirSync(framesDir)
    .filter((name) => name.endsWith('.png'))
    .sort();

  if (frameFiles.length === 0) {
    throw new Error('No PNG frames found for GIF encoding.');
  }

  const decodedFrames = frameFiles.map((fileName) => {
    const input = readFileSync(path.resolve(framesDir, fileName));
    return PNG.sync.read(input);
  });

  const width = decodedFrames[0].width;
  const height = decodedFrames[0].height;
  const mergedPixels = [];

  for (const frame of decodedFrames) {
    const rgba = frame.data;
    for (let i = 0; i < rgba.length; i += 1) {
      mergedPixels.push(rgba[i]);
    }
  }

  const palette = quantize(Uint8Array.from(mergedPixels), 256);
  const gif = GIFEncoder();

  for (const frame of decodedFrames) {
    const indexed = applyPalette(frame.data, palette, 'rgb444');
    gif.writeFrame(indexed, width, height, { palette, delay: frameDelayMs });
  }

  gif.finish();
  writeFileSync(outputGif, gif.bytesView());
};

const run = async () => {
  ensureCleanDir(framesDir);
  ensureCleanDir(userDataDir);
  ensureDir(screenshotsDir);

  for (const entry of readdirSync(screenshotsDir)) {
    if (entry.toLowerCase().endsWith('.png')) {
      rmSync(path.resolve(screenshotsDir, entry), { force: true });
    }
  }

  const popupPath = readExtensionPopupPath();
  const { chromium } = await import('playwright');

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: false,
    viewport: { width: outputWidth, height: outputHeight },
    args: [
      `--disable-extensions-except=${extensionDistPath}`,
      `--load-extension=${extensionDistPath}`
    ]
  });

  try {
    const extensionId = await getExtensionId(context);
    const popupUrl = `chrome-extension://${extensionId}/${popupPath}`;
    const page = await context.newPage();

    await page.goto(popupUrl, { waitUntil: 'networkidle' });

    let frame = 1;
    await saveFrame(page, frame, 3);
    await saveMarketingScreenshot(page, '01-create-vault-start.png');
    frame += 3;

    await clickByText(page, ['Create Vault', 'Create Wallet']);
    await page.waitForLoadState('networkidle');
    await saveFrame(page, frame, 3);
    frame += 3;

    await clickByText(page, ['Continue', 'Next', 'Create Vault', 'Create Wallet', 'OK, I have saved it', 'I have saved it']);
    await page.waitForLoadState('networkidle');
    await saveFrame(page, frame, 3);
    frame += 3;

    const password = process.env.DEMO_PASSWORD || 'demo-vault-pass-123';
    await fillVisiblePasswordFields(page, password);
    await saveFrame(page, frame, 3);
    await saveMarketingScreenshot(page, '02-password-setup.png');
    frame += 3;

    await clickByText(page, ['Save', 'Create', 'Continue', 'Unlock Vault', 'Unlock Wallet', 'Unlock']);
    await page.waitForLoadState('networkidle');
    await sleep(1200);
    await saveFrame(page, frame, 3);
    frame += 3;

    await fillVisiblePasswordFields(page, password);
    await clickByText(page, ['Unlock Vault', 'Unlock Wallet', 'Unlock']);
    await page.waitForLoadState('networkidle');
    await sleep(1200);
    await saveFrame(page, frame, 3);
    await saveMarketingScreenshot(page, '03-dashboard.png');
    frame += 3;

    await gotoRoute(page, '#/dashboard');
    await clickFirstAccountFromDashboard(page);
    await saveFrame(page, frame, 4);
    await saveMarketingScreenshot(page, '04-account-npub-qr.png');
    frame += 4;

    await gotoRoute(page, '#/settings');
    await saveFrame(page, frame, 3);
    await saveMarketingScreenshot(page, '05-settings-top.png');
    frame += 3;

    await page.mouse.wheel(0, 1200);
    await sleep(900);
    await saveFrame(page, frame, 5);
    await saveMarketingScreenshot(page, '06-settings-scrolled.png');

    const frameCount = readdirSync(framesDir).filter((name) => name.endsWith('.png')).length;
    if (frameCount < 3) {
      throw new Error('Not enough frames were captured to build a GIF.');
    }

    encodeGif();
    console.log(`Created ${outputGif}`);
  } finally {
    await context.close();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
