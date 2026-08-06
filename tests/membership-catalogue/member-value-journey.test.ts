import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemberValueJourney } from '@/components/member-value-journey';
import type { Locale } from '@/i18n/config';

const LOCALES: Locale[] = ['az', 'ru', 'en'];

const EXPECTED_STEP_TITLES: Record<Locale, string[]> = {
  az: ['Tələb', 'AI araşdırması', 'Mövcud tariflərin müqayisəsi', 'İnsan yoxlaması', 'Təsdiq', 'Rezervasiya əlaqələndirilməsi', 'Trip Room', 'Davamlı dəstək'],
  ru: ['Запрос', 'Исследование ИИ', 'Сравнение доступных тарифов', 'Проверка человеком', 'Подтверждение', 'Координация бронирования', 'Trip Room', 'Постоянная поддержка'],
  en: ['Request', 'AI research', 'Available-rate comparison', 'Human review', 'Approval', 'Booking coordination', 'Trip Room', 'Ongoing support']
};

const OPERATING_PRINCIPLE_FRAGMENT: Record<Locale, string> = {
  az: 'Süni intellekt hazırlayır',
  ru: 'ИИ готовит',
  en: 'AI prepares'
};

function render(locale: Locale): string {
  return renderToStaticMarkup(React.createElement(MemberValueJourney, { locale }));
}

for (const locale of LOCALES) {
  test(`member-value journey (${locale}): renders all 8 step titles, in order, as step headers`, () => {
    const html = render(locale);
    const headerTitles = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]);
    assert.deepEqual(headerTitles, EXPECTED_STEP_TITLES[locale]);
  });

  test(`member-value journey (${locale}): renders exactly 8 <li> step entries`, () => {
    const html = render(locale);
    const matches = html.match(/class="mvj-step"/g) ?? [];
    assert.equal(matches.length, 8);
  });

  test(`member-value journey (${locale}): displays the locked operating principle correctly localized`, () => {
    const html = render(locale);
    assert.ok(html.includes(OPERATING_PRINCIPLE_FRAGMENT[locale]), `expected operating-principle fragment for ${locale}`);
  });

  test(`member-value journey (${locale}): brand name "VOYARA AI" is present and unchanged`, () => {
    const html = render(locale);
    assert.ok(html.includes('VOYARA AI'));
  });

  test(`member-value journey (${locale}): every step includes all five detail fields (provides/prepares/value/approval/next)`, () => {
    const html = render(locale);
    // Five <dt> label groups per step x 8 steps = 40 <dt> elements minimum.
    const dtCount = (html.match(/<dt>/g) ?? []).length;
    assert.equal(dtCount, 40, `expected 40 <dt> elements (5 fields x 8 steps), found ${dtCount}`);
  });
}

test('no Cyrillic text appears in the AZ or EN renderings', () => {
  const cyrillic = /[\u0400-\u04FF]/;
  for (const locale of ['az', 'en'] as Locale[]) {
    const html = render(locale);
    assert.ok(!cyrillic.test(html), `unexpected Cyrillic text found in ${locale} rendering`);
  }
});

test('no Azerbaijani-distinctive characters appear in the RU or EN renderings', () => {
  const azDistinctive = /[əğıöüşçİ]/i;
  for (const locale of ['ru', 'en'] as Locale[]) {
    const html = render(locale);
    assert.ok(!azDistinctive.test(html), `unexpected Azerbaijani-distinctive character found in ${locale} rendering`);
  }
});

test('the three locale renderings are not identical to one another (independently written content)', () => {
  const az = render('az');
  const ru = render('ru');
  const en = render('en');
  assert.notEqual(az, ru);
  assert.notEqual(az, en);
  assert.notEqual(ru, en);
});
