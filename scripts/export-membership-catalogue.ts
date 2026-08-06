#!/usr/bin/env -S npx tsx
/**
 * Phase C7 — deterministic bridge from the authoritative membership
 * catalogue (src/lib/membership-catalogue.ts) to the standalone HTML
 * generator (build-final-interactive-demo.mjs).
 *
 * This script is the ONLY place that reads `membership-catalogue.ts` for
 * the purpose of the standalone demo. It writes one deterministic JSON
 * file; the generator reads that file and never re-declares plan names,
 * prices, or benefit copy of its own.
 *
 * Determinism: object keys below are written in a fixed, explicit order
 * (locale order az/ru/en, plan order = catalogue displayOrder) and
 * JSON.stringify with a fixed indent — running this script twice against
 * an unchanged catalogue produces byte-identical output.
 *
 * Usage:
 *   npx tsx scripts/export-membership-catalogue.ts
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MEMBERSHIP_CATALOGUE,
  PERSONAL_PLANS,
  CORPORATE_PLANS,
  getFullBenefitList,
  getInheritanceLabel,
  getResolvedPricing,
  ANNUAL_VALUE_FRAMING
} from '../src/lib/membership-catalogue';
import {
  PERSONAL_ROWS,
  CORPORATE_ROWS,
  HEADER_TEXT as COMPARISON_HEADER_TEXT,
  cellDisplay
} from '../src/lib/membership-comparison-data';
import {
  JOURNEY_TITLE,
  JOURNEY_INTRO,
  OPERATING_PRINCIPLE,
  STEPS_BY_LOCALE as JOURNEY_STEPS_BY_LOCALE,
  FIELD_LABELS as JOURNEY_FIELD_LABELS
} from '../src/lib/member-value-journey-data';
import {
  SECTION_TITLE as AGENT_SECTION_TITLE,
  SECTION_INTRO as AGENT_SECTION_INTRO,
  STATUS_LABEL as AGENT_STATUS_LABEL,
  AGENTS_BY_LOCALE,
  FIELD_LABELS as AGENT_FIELD_LABELS
} from '../src/lib/ai-agent-membership-data';
import type { Locale } from '../src/i18n/config';
import type { PlanCode } from '../src/server/agents/subscriptions/plan-authority';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'scripts/build-final-interactive-demo.membership-catalogue.json');

const LOCALES: Locale[] = ['az', 'ru', 'en'];

interface ExportedPlan {
  planCode: PlanCode;
  slug: string;
  category: 'PERSONAL' | 'CORPORATE';
  displayOrder: number;
  name: string;
  positioning: string;
  bestFor: string;
  inheritanceLabel: string | null;
  benefits: string[];
  memberRateAccess: string;
  searchDepth: string;
  servicePriority: string;
  humanReviewLevel: string;
  conciergeLevel: string;
  humanApprovalBoundary: string;
  fairUseDisclosure: string;
  availabilityDisclosure: string;
  ctaLabel: string;
  upgradeTrigger: string;
  pricing: {
    monthly: number | null;
    annual: number | null;
    annualSaving: number | null;
    isCustomPriced: boolean;
  };
}

interface ExportedComparisonTable {
  title: string;
  featureLabel: string;
  planNames: string[];
  rows: Array<{ key: string; label: string; cells: (string | boolean)[] }>;
}

function exportComparisonForLocale(locale: Locale): { personal: ExportedComparisonTable; corporate: ExportedComparisonTable } {
  const h = COMPARISON_HEADER_TEXT[locale];
  return {
    personal: {
      title: h.personalTitle,
      featureLabel: h.feature,
      planNames: PERSONAL_PLANS.map((p) => p.name[locale]),
      rows: PERSONAL_ROWS.map((row) => ({
        key: row.key,
        label: row.label[locale],
        cells: PERSONAL_PLANS.map((plan) => cellDisplay(row.values(plan, locale), locale))
      }))
    },
    corporate: {
      title: h.corporateTitle,
      featureLabel: h.feature,
      planNames: CORPORATE_PLANS.map((p) => p.name[locale]),
      rows: CORPORATE_ROWS.map((row) => ({
        key: row.key,
        label: row.label[locale],
        cells: CORPORATE_PLANS.map((plan) => cellDisplay(row.values(plan, locale), locale))
      }))
    }
  };
}

interface ExportedJourneyStep {
  title: string;
  customerProvides: string;
  voyaraPrepares: string;
  commercialValue: string;
  approvalPoint: string;
  nextStep: string;
}

function exportJourneyForLocale(locale: Locale) {
  return {
    title: JOURNEY_TITLE[locale],
    intro: JOURNEY_INTRO[locale],
    operatingPrinciple: OPERATING_PRINCIPLE[locale],
    fieldLabels: JOURNEY_FIELD_LABELS[locale],
    steps: JOURNEY_STEPS_BY_LOCALE[locale].map((step): ExportedJourneyStep => ({
      title: step.title,
      customerProvides: step.customerProvides,
      voyaraPrepares: step.voyaraPrepares,
      commercialValue: step.commercialValue,
      approvalPoint: step.approvalPoint,
      nextStep: step.nextStep
    }))
  };
}

function exportAgentsForLocale(locale: Locale) {
  return {
    title: AGENT_SECTION_TITLE[locale],
    intro: AGENT_SECTION_INTRO[locale],
    fieldLabels: AGENT_FIELD_LABELS[locale],
    agents: AGENTS_BY_LOCALE[locale].map((agent) => ({
      key: agent.key,
      name: agent.name,
      memberBenefit: agent.memberBenefit,
      prepares: agent.prepares,
      safelyAutomates: agent.safelyAutomates,
      requiresApproval: agent.requiresApproval,
      channel: agent.channel,
      status: agent.status,
      statusLabel: AGENT_STATUS_LABEL[locale][agent.status]
    }))
  };
}

function exportForLocale(locale: Locale): ExportedPlan[] {
  return MEMBERSHIP_CATALOGUE.map((plan) => {
    const resolved = getResolvedPricing(plan.planCode);
    return {
      planCode: plan.planCode,
      slug: plan.slug,
      category: plan.category,
      displayOrder: plan.displayOrder,
      name: plan.name[locale],
      positioning: plan.positioning[locale],
      bestFor: plan.bestFor[locale],
      inheritanceLabel: getInheritanceLabel(plan.planCode, locale),
      benefits: getFullBenefitList(plan.planCode, locale),
      memberRateAccess: plan.memberRateAccess[locale],
      searchDepth: plan.searchDepth[locale],
      servicePriority: plan.servicePriority,
      humanReviewLevel: plan.humanReviewLevel,
      conciergeLevel: plan.conciergeLevel,
      humanApprovalBoundary: plan.humanApprovalBoundary[locale],
      fairUseDisclosure: plan.fairUseDisclosure[locale],
      availabilityDisclosure: plan.availabilityDisclosure[locale],
      ctaLabel: plan.ctaLabel[locale],
      upgradeTrigger: plan.upgradeTrigger[locale],
      pricing: {
        monthly: resolved.monthlyDisplay,
        annual: resolved.annualDisplay,
        annualSaving: resolved.annualSavingDisplay,
        isCustomPriced: resolved.isCustomPriced
      }
    };
  }).sort((a, b) => a.displayOrder - b.displayOrder);
}

const output = {
  generatedFrom: 'src/lib/membership-catalogue.ts',
  generatorScript: 'scripts/export-membership-catalogue.ts',
  locales: LOCALES,
  annualValueFraming: { az: ANNUAL_VALUE_FRAMING.az, ru: ANNUAL_VALUE_FRAMING.ru, en: ANNUAL_VALUE_FRAMING.en },
  plans: {
    az: exportForLocale('az'),
    ru: exportForLocale('ru'),
    en: exportForLocale('en')
  },
  comparison: {
    az: exportComparisonForLocale('az'),
    ru: exportComparisonForLocale('ru'),
    en: exportComparisonForLocale('en')
  },
  journey: {
    az: exportJourneyForLocale('az'),
    ru: exportJourneyForLocale('ru'),
    en: exportJourneyForLocale('en')
  },
  agents: {
    az: exportAgentsForLocale('az'),
    ru: exportAgentsForLocale('ru'),
    en: exportAgentsForLocale('en')
  }
};

// Fixed 2-space indent, trailing newline — deterministic across runs.
writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`Exported ${OUT_PATH} (${MEMBERSHIP_CATALOGUE.length} plans x ${LOCALES.length} locales)\n`);
