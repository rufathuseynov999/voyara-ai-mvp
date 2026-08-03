'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const projectRoot = path.resolve(__dirname, '..', '..');
const port = 43173;
const baseUrl = `http://127.0.0.1:${port}`;
const expectedScreens = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

function waitForServer(attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(baseUrl, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else if (remaining > 0) setTimeout(() => check(remaining - 1), 50);
        else reject(new Error(`Server returned ${response.statusCode}`));
      });
      request.on('error', () => {
        if (remaining > 0) setTimeout(() => check(remaining - 1), 50);
        else reject(new Error('Local server did not start'));
      });
    };
    check(attempts);
  });
}

async function screenDiagnostics(page, id) {
  await page.locator(`.tab[data-s="${id}"]`).click();
  await page.waitForTimeout(40);
  return page.evaluate((screenId) => {
    const active = [...document.querySelectorAll('.screen.on')].map((element) => element.id);
    const screen = document.getElementById(screenId);
    return {
      id: screenId,
      active,
      visible: Boolean(screen && getComputedStyle(screen).display !== 'none'),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
    };
  }, id);
}

async function run() {
  const server = spawn(process.execPath, ['reference/task-001/legacy-serve.cjs'], {
    cwd: projectRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let browser;
  const report = {
    url: baseUrl,
    browser: 'chromium',
    desktop: [],
    mobile: [],
    tripRoomTabs: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    accessibility: {},
    document: {}
  };

  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? ['--no-sandbox'] : []
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
    });
    await page.route('https://**', (route) => route.abort('blockedbyclient'));

    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200, 'The local page must return HTTP 200');

    report.document = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
      const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
      return {
        title: document.title,
        lang: document.documentElement.lang,
        screenIds: [...document.querySelectorAll('section.screen')].map((element) => element.id),
        duplicateIds: duplicates,
        inlineScripts: document.querySelectorAll('script:not([src])').length,
        inlineStyles: document.querySelectorAll('style').length,
        externalScripts: [...document.querySelectorAll('script[src]')].map((element) => element.src),
        externalStylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((element) => element.href),
        anchorsWithoutHref: document.querySelectorAll('a:not([href])').length,
        forms: document.querySelectorAll('form').length,
        inputs: document.querySelectorAll('input, select, textarea').length
      };
    });

    assert.deepEqual(report.document.screenIds, expectedScreens, 'The demo must expose the eight authoritative screen IDs');
    assert.deepEqual(report.document.duplicateIds, [], 'DOM IDs must be unique');

    for (const id of expectedScreens) {
      const diagnostic = await screenDiagnostics(page, id);
      assert.deepEqual(diagnostic.active, [id], `Only ${id} should be active after its tab is selected`);
      assert.equal(diagnostic.visible, true, `${id} should be visible after selection`);
      report.desktop.push(diagnostic);
    }

    await page.locator('.tab[data-s="s1"]').click();
    await page.locator('#next').click();
    assert.equal(await page.locator('.screen.on').getAttribute('id'), 's2', 'Presenter next control should advance screens');
    await page.locator('#prev').click();
    assert.equal(await page.locator('.screen.on').getAttribute('id'), 's1', 'Presenter previous control should reverse screens');

    await page.locator('.tab[data-s="s6"]').click();
    const tripTabs = await page.locator('#s6 .tr6-tab').count();
    for (let index = 0; index < tripTabs; index += 1) {
      const tab = page.locator('#s6 .tr6-tab').nth(index);
      const key = await tab.getAttribute('data-t');
      await tab.click();
      const activePanel = await page.locator('#s6 .tr6-panel.on').getAttribute('data-p');
      assert.equal(activePanel, key, `Trip Room tab ${key} should activate its matching panel`);
      report.tripRoomTabs.push(key);
    }

    report.accessibility = await page.evaluate(() => ({
      images: document.images.length,
      imagesMissingAlt: [...document.images].filter((image) => !image.hasAttribute('alt')).length,
      buttons: document.querySelectorAll('button').length,
      unnamedButtons: [...document.querySelectorAll('button')].filter((button) => {
        const name = button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent.trim();
        return !name;
      }).length,
      targetBlankWithoutNoopener: [...document.querySelectorAll('a[target="_blank"]')].filter((anchor) => !anchor.rel.split(/\s+/).includes('noopener')).length,
      mainLandmarks: document.querySelectorAll('main').length,
      h1Count: document.querySelectorAll('h1').length
    }));

    await page.setViewportSize({ width: 375, height: 812 });
    for (const id of expectedScreens) {
      report.mobile.push(await screenDiagnostics(page, id));
    }

    assert.deepEqual(report.pageErrors, [], 'The browser must not emit uncaught JavaScript errors');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
