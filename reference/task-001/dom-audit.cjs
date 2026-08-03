'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const projectRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(__dirname, 'voyara-mvp-demo-july7-10.html');
const source = fs.readFileSync(sourcePath, 'utf8');
const expectedScreens = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const scriptErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => scriptErrors.push(error.message));

const dom = new JSDOM(source, {
  runScripts: 'dangerously',
  url: 'http://127.0.0.1:4173/',
  virtualConsole,
  beforeParse(window) {
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
});

const { document, MouseEvent, KeyboardEvent } = dom.window;
const report = {
  source: {
    bytes: Buffer.byteLength(source),
    lines: source.split('\n').length,
    inlineScriptBlocks: (source.match(/<script(?:\s[^>]*)?>/gi) || []).length,
    inlineStyleBlocks: (source.match(/<style(?:\s[^>]*)?>/gi) || []).length,
    embeddedDataImages: (source.match(/data:image\//gi) || []).length,
    fetchCalls: (source.match(/\bfetch\s*\(/g) || []).length,
    xhrReferences: (source.match(/\bXMLHttpRequest\b/g) || []).length,
    webSocketReferences: (source.match(/\bWebSocket\b/g) || []).length,
    localStorageReferences: (source.match(/\blocalStorage\b/g) || []).length,
    sessionStorageReferences: (source.match(/\bsessionStorage\b/g) || []).length,
    innerHtmlWrites: (source.match(/\.innerHTML\s*=/g) || []).length,
    evalCalls: (source.match(/\beval\s*\(/g) || []).length,
    mediaQueries: (source.match(/@media\b/g) || []).length
  },
  document: {},
  interactions: {
    screenSwitcher: [],
    presenter: {},
    tripRoomTabs: []
  },
  accessibility: {},
  localisationSignals: {},
  scriptErrors
};

const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
report.document = {
  title: document.title,
  lang: document.documentElement.lang,
  viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || null,
  screenIds: [...document.querySelectorAll('section.screen')].map((element) => element.id),
  duplicateIds: [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))],
  forms: document.querySelectorAll('form').length,
  inputs: document.querySelectorAll('input, select, textarea').length,
  anchorsWithoutHref: document.querySelectorAll('a:not([href])').length,
  inertBusinessButtons: document.querySelectorAll('button:not(.tab):not(.tr6-tab):not(#next):not(#prev)').length,
  externalStylesheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map((element) => element.href),
  externalScripts: [...document.querySelectorAll('script[src]')].map((element) => element.src)
};

assert.deepEqual(report.document.screenIds, expectedScreens, 'The eight authoritative screen IDs must exist in order');
assert.deepEqual(report.document.duplicateIds, [], 'DOM IDs must be unique');
assert.deepEqual([...document.querySelectorAll('.screen.on')].map((element) => element.id), ['s1'], 'Landing must be the initial screen');

for (const id of expectedScreens) {
  const tab = document.querySelector(`.tab[data-s="${id}"]`);
  assert.ok(tab, `Switcher tab for ${id} must exist`);
  tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const activeScreens = [...document.querySelectorAll('.screen.on')].map((element) => element.id);
  assert.deepEqual(activeScreens, [id], `Only ${id} should be active after its switcher tab is clicked`);
  report.interactions.screenSwitcher.push({ id, activeScreens });
}

document.querySelector('.tab[data-s="s1"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
document.getElementById('next').dispatchEvent(new MouseEvent('click', { bubbles: true }));
report.interactions.presenter.afterNext = document.querySelector('.screen.on')?.id;
assert.equal(report.interactions.presenter.afterNext, 's2', 'Presenter next control should advance to s2');
document.getElementById('prev').dispatchEvent(new MouseEvent('click', { bubbles: true }));
report.interactions.presenter.afterPrevious = document.querySelector('.screen.on')?.id;
assert.equal(report.interactions.presenter.afterPrevious, 's1', 'Presenter previous control should return to s1');
dom.window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
report.interactions.presenter.afterArrowRight = document.querySelector('.screen.on')?.id;
assert.equal(report.interactions.presenter.afterArrowRight, 's2', 'ArrowRight should advance the presenter');

document.querySelector('.tab[data-s="s6"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
for (const tab of document.querySelectorAll('#s6 .tr6-tab')) {
  const key = tab.getAttribute('data-t');
  tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const activePanels = [...document.querySelectorAll('#s6 .tr6-panel.on')].map((panel) => panel.getAttribute('data-p'));
  assert.deepEqual(activePanels, [key], `Trip Room tab ${key} must expose only its matching panel`);
  report.interactions.tripRoomTabs.push({ key, activePanels });
}

report.accessibility = {
  images: document.images.length,
  imagesMissingAlt: [...document.images].filter((image) => !image.hasAttribute('alt')).length,
  buttons: document.querySelectorAll('button').length,
  unnamedButtons: [...document.querySelectorAll('button')].filter((button) => {
    const name = button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent.trim();
    return !name;
  }).length,
  targetBlankWithoutNoopener: [...document.querySelectorAll('a[target="_blank"]')].filter((anchor) => !anchor.rel.split(/\s+/).includes('noopener')).length,
  mainLandmarks: document.querySelectorAll('main').length,
  navLandmarks: document.querySelectorAll('nav').length,
  h1Count: document.querySelectorAll('h1').length,
  labelledInputs: 0
};

for (const id of expectedScreens) {
  const text = document.getElementById(id)?.textContent || '';
  report.localisationSignals[id] = {
    cyrillicCharacters: (text.match(/[\u0400-\u04FF]/g) || []).length,
    azerbaijaniSpecificCharacters: (text.match(/[ƏəĞğİıÖöŞşÜüÇç]/g) || []).length,
    characters: text.trim().length
  };
}

assert.deepEqual(scriptErrors, [], 'Inline scripts must execute without jsdom errors');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
