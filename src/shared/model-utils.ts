import type { ParsedModelInfo } from './types.js';

const EFFORT_SUFFIXES: Array<[RegExp, string]> = [
  [/-xhigh$/i, 'XHigh'],
  [/-high$/i, 'High'],
  [/-medium$/i, 'Medium'],
  [/-low$/i, 'Low'],
  [/-max$/i, 'Max'],
];

const ORCHESTRATOR_MAP: Record<string, { familyKey: string; familyName: string }> = {
  'gemini-pro-orchestrator-neon': {
    familyKey: 'gemini-pro-orchestrator',
    familyName: 'Orchestrator (Neon)',
  },
  'gemini-pro-orchestrator': {
    familyKey: 'gemini-pro-orchestrator',
    familyName: 'Orchestrator (Carbon)',
  },
  'gemini-pro-orchestrator-argon': {
    familyKey: 'gemini-pro-orchestrator',
    familyName: 'Orchestrator (Argon)',
  },
};

const FAMILY_RULES: Array<{
  pattern: RegExp;
  familyKey: string;
  familyName: string;
  group: 'Gemini Models' | 'Claude & GPT';
}> = [
  {
    pattern: /^gemini-4-neon(?:-(?:tiered|xhigh|high|medium|low|max))*$/i,
    familyKey: 'gemini-4-neon',
    familyName: 'Gemini 4 Neon',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-4-carbon(?:-(?:tiered|xhigh|high|medium|low|max))*$/i,
    familyKey: 'gemini-4-carbon',
    familyName: 'Gemini 4 Carbon',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-4-argon(?:-(?:tiered|xhigh|high|medium|low|max))*$/i,
    familyKey: 'gemini-4-argon',
    familyName: 'Gemini 4 Argon',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-4-hydrogen(?:-(?:tiered|xhigh|high|medium|low|max))*$/i,
    familyKey: 'gemini-4-hydrogen',
    familyName: 'Gemini 4 Hydrogen',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-3\.8-flash(?:-(?:tiered|xhigh|high|medium|low|max))*$/i,
    familyKey: 'gemini-3.8-flash',
    familyName: 'Gemini 3.8 Flash',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-3\.7-flash/i,
    familyKey: 'gemini-3.8-flash',
    familyName: 'Gemini 3.7 Flash',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-3\.6-flash/i,
    familyKey: 'gemini-3.8-flash',
    familyName: 'Gemini 3.6 Flash',
    group: 'Gemini Models',
  },
  {
    pattern: /^gemini-3\.1-pro/i,
    familyKey: 'gemini-4-carbon',
    familyName: 'Gemini 3.1 Pro',
    group: 'Gemini Models',
  },
  {
    pattern: /^claude-opus-5-5/i,
    familyKey: 'claude-opus-5-5',
    familyName: 'Claude Opus 5.5',
    group: 'Claude & GPT',
  },
  {
    pattern: /^claude-sonnet-5-5/i,
    familyKey: 'claude-sonnet-5-5',
    familyName: 'Claude Sonnet 5.5',
    group: 'Claude & GPT',
  },
  {
    pattern: /^claude-opus-4-6/i,
    familyKey: 'claude-opus-5-5',
    familyName: 'Claude Opus 4.6',
    group: 'Claude & GPT',
  },
  {
    pattern: /^claude-sonnet-4-6/i,
    familyKey: 'claude-sonnet-5-5',
    familyName: 'Claude Sonnet 4.6',
    group: 'Claude & GPT',
  },
  {
    pattern: /^gpt-oss-120b/i,
    familyKey: 'gpt-oss-120b',
    familyName: 'GPT-OSS 120B',
    group: 'Claude & GPT',
  },
];

function extractEffort(slug: string): string | null {
  for (const [re, label] of EFFORT_SUFFIXES) {
    if (re.test(slug)) {
      return label;
    }
  }
  return null;
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/-(xhigh|high|medium|low|max|tiered)$/i, '')
    .split('-')
    .filter(Boolean)
    .map((part) => {
      if (part === 'gpt' || part === 'oss') return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function parseModelSlug(raw: string | null | undefined): ParsedModelInfo {
  const slug = (raw ?? '').trim();
  if (!slug) {
    return {
      familyKey: 'legacy',
      familyName: 'Legacy (sin modelo)',
      effort: null,
      group: 'Legacy',
      isLegacy: true,
      slug: '',
    };
  }

  const lower = slug.toLowerCase();
  const orch = ORCHESTRATOR_MAP[lower];
  if (orch) {
    return {
      familyKey: orch.familyKey,
      familyName: orch.familyName,
      effort: 'Auto',
      group: 'Gemini Models',
      isLegacy: false,
      slug,
    };
  }

  const effort = extractEffort(lower);
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(lower)) {
      return {
        familyKey: rule.familyKey,
        familyName: rule.familyName,
        effort,
        group: rule.group,
        isLegacy: false,
        slug,
      };
    }
  }

  const inferredGroup: 'Gemini Models' | 'Claude & GPT' =
    lower.includes('claude') || lower.includes('gpt') ? 'Claude & GPT' : 'Gemini Models';

  return {
    familyKey: lower.replace(/-(xhigh|high|medium|low|max|tiered)$/gi, ''),
    familyName: titleCaseSlug(slug) || slug,
    effort,
    group: inferredGroup,
    isLegacy: false,
    slug,
  };
}
