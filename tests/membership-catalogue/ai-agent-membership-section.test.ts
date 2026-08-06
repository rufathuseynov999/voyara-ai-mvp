import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiAgentMembershipSection } from '@/components/ai-agent-membership-section';
import type { Locale } from '@/i18n/config';

const LOCALES: Locale[] = ['az', 'ru', 'en'];

const EXPECTED_AGENT_NAMES: Record<Locale, string[]> = {
  az: ['Səs Qəbulu Agenti', 'Satış Agenti', 'Konsyerj Agenti', 'Əməliyyat Agenti', 'Korporativ Masa Agenti', 'SMM və Kontent Agenti', 'Marketinq Strateji Agenti', 'COO Agenti'],
  ru: ['Агент голосового приёма', 'Агент продаж', 'Агент консьержа', 'Агент операций', 'Агент корпоративного отдела', 'Агент SMM и контента', 'Агент маркетинговой стратегии', 'Агент COO'],
  en: ['Voice Reception Agent', 'Sales Agent', 'Concierge Agent', 'Operations Agent', 'Corporate Desk Agent', 'SMM & Content Agent', 'Marketing Strategist Agent', 'COO Agent']
};

// The only vocabulary honest statuses may render as, per locale.
const ALLOWED_STATUS_LABELS: Record<Locale, string[]> = {
  az: ['Tətbiq olunub', 'Qaydaya əsaslanan (deterministik)', 'Simulyasiya rejimində', 'Provayder konfiqurasiya olunmayıb', 'İnsan təsdiqi tələb olunur', 'Aktivləşdirmə gözlənilir'],
  ru: ['Реализовано', 'Детерминированное (на основе правил)', 'В режиме симуляции', 'Провайдер не настроен', 'Требуется подтверждение человеком', 'Ожидает активации'],
  en: ['Implemented', 'Deterministic (rule-based)', 'Simulated', 'Provider not configured', 'Human approval required', 'Activation pending']
};

// Phrases that would constitute an over-claim of autonomy — must never appear.
const FORBIDDEN_AUTONOMY_CLAIMS = [
  /fully\s+autonomous/i, /runs?\s+continuously\s+in\s+production/i, /always\s+live/i,
  /tam\s+avtonom/i, /polностью\s+автоном/i, /непрерывно\s+работает\s+в\s+продакшн/i
];

function normalizeForSearch(html: string): string {
  return html.replace(/&amp;/g, '&');
}

function render(locale: Locale): string {
  return renderToStaticMarkup(React.createElement(AiAgentMembershipSection, { locale }));
}

function extractStatusLabels(html: string): string[] {
  return [...html.matchAll(/class="ai-agent-status[^"]*">([^<]+)</g)].map((m) => m[1]);
}

for (const locale of LOCALES) {
  test(`AI-agent section (${locale}): renders all 8 agent names`, () => {
    const html = normalizeForSearch(render(locale));
    for (const name of EXPECTED_AGENT_NAMES[locale]) {
      assert.ok(html.includes(name), `expected agent name "${name}" in ${locale} markup`);
    }
  });

  test(`AI-agent section (${locale}): renders exactly 8 agent cards`, () => {
    const html = render(locale);
    const matches = html.match(/class="ai-agent-card"/g) ?? [];
    assert.equal(matches.length, 8);
  });

  test(`AI-agent section (${locale}): every rendered status is from the honest allowed vocabulary only`, () => {
    const html = render(locale);
    const statuses = extractStatusLabels(html);
    assert.equal(statuses.length, 8, 'expected exactly one status badge per agent');
    for (const status of statuses) {
      assert.ok(ALLOWED_STATUS_LABELS[locale].includes(status), `status "${status}" is not part of the honest allowed vocabulary for ${locale}`);
    }
  });

  test(`AI-agent section (${locale}): no forbidden autonomy over-claims appear anywhere`, () => {
    const html = render(locale);
    for (const pattern of FORBIDDEN_AUTONOMY_CLAIMS) {
      assert.ok(!pattern.test(html), `forbidden autonomy claim matched pattern ${pattern} in ${locale} markup`);
    }
  });

  test(`AI-agent section (${locale}): Concierge, Corporate Desk and Marketing Strategist agents are honestly marked activation-pending (no dedicated backing module exists)`, () => {
    const html = render(locale);
    const pendingLabel = ALLOWED_STATUS_LABELS[locale][5]; // 'Activation pending' / localized equivalent
    const pendingCount = (html.match(new RegExp(pendingLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    assert.equal(pendingCount, 3, `expected exactly 3 agents marked "${pendingLabel}" in ${locale}, found ${pendingCount}`);
  });

  test(`AI-agent section (${locale}): Sales, Operations, SMM & Content and COO agents are marked deterministic (real, non-LLM-dependent source modules)`, () => {
    const html = render(locale);
    const deterministicLabel = ALLOWED_STATUS_LABELS[locale][1];
    const count = (html.match(new RegExp(deterministicLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    assert.equal(count, 4, `expected exactly 4 agents marked "${deterministicLabel}" in ${locale}, found ${count}`);
  });

  test(`AI-agent section (${locale}): Voice Reception Agent is marked simulated (LLM-dependent, no provider credentials exist)`, () => {
    const html = render(locale);
    const simulatedLabel = ALLOWED_STATUS_LABELS[locale][2];
    const count = (html.match(new RegExp(simulatedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
    assert.equal(count, 1, `expected exactly 1 agent marked "${simulatedLabel}" in ${locale}, found ${count}`);
  });
}

test('the three locale renderings are independently written (not identical)', () => {
  const az = render('az');
  const ru = render('ru');
  const en = render('en');
  assert.notEqual(az, ru);
  assert.notEqual(az, en);
  assert.notEqual(ru, en);
});
