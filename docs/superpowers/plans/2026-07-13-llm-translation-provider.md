# LLM Translation Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-based translation provider that reuses the existing AI settings (provider/apiKey/model), remove the translation quota/premium system, remove DeepL/Azure/Yandex providers, and enable the AI settings panel in production builds.

**Architecture:** A new `llm.ts` translation provider bridges the translation system to the existing AI service infrastructure (`getAIProvider` + Vercel AI SDK `generateText`). Multiple texts are batched into one LLM call using a delimiter-based strategy with per-text fallback. The translation quota system and old providers (DeepL/Azure/Yandex) are removed entirely.

**Tech Stack:** TypeScript, React, Vercel AI SDK (`ai` package), Zustand, Vitest

**Spec:** `docs/superpowers/specs/2026-07-13-llm-translation-design.md`

---

## File Structure

| Operation | File | Responsibility |
|-----------|------|----------------|
| Create | `src/services/translators/providers/llm.ts` | LLM translation provider implementation |
| Create | `src/__tests__/services/translators/providers/llm.test.ts` | Unit tests for LLM provider |
| Modify | `src/services/translators/providers/index.ts` | Provider registry: remove old, add LLM |
| Modify | `src/services/constants.ts` | Default values: `aiSettings.enabled=true`, `translationProvider='google'` |
| Modify | `src/components/settings/SettingsDialog.tsx` | Remove AI panel production gate |
| Modify | `src/hooks/useTranslator.ts` | Remove quota catch block, change default provider |
| Modify | `src/services/translators/utils.ts` | Remove `saveDailyUsage`/`getDailyUsage`/`DAILY_USAGE_KEY` |
| Modify | `src/__tests__/services/translators/providers.test.ts` | Remove deleted provider tests, update registry tests |
| Delete | `src/services/translators/providers/deepl.ts` | DeepL provider removed |
| Delete | `src/services/translators/providers/azure.ts` | Azure provider removed |
| Delete | `src/services/translators/providers/yandex.ts` | Yandex provider removed |
| Delete | `src/pages/api/deepl/translate.ts` | DeepL API endpoint removed |

---

### Task 1: Write LLM provider unit tests (TDD)

**Files:**
- Create: `src/__tests__/services/translators/providers/llm.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the 'ai' module — generateText is the only export we use.
vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

// Mock settings store so we can control aiSettings per test.
const mockGetState = vi.fn();
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: mockGetState,
  },
}));

// Mock AI provider factory — we only need getModel() to return a sentinel.
const mockGetAIProvider = vi.fn();
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: mockGetAIProvider,
}));

// Mock stubTranslation (non-React i18n stub).
vi.mock('@/utils/misc', () => ({
  stubTranslation: (s: string) => s,
}));

// Mock supabase to prevent GoTrueClient warnings on import.
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  },
}));

import { generateText } from 'ai';
import { llmProvider } from '@/services/translators/providers/llm';

const mockGenerateText = vi.mocked(generateText);

const DEFAULT_AI_SETTINGS = {
  enabled: true,
  provider: 'openrouter' as const,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'llama3.2',
  ollamaEmbeddingModel: 'nomic-embed-text',
  openrouterApiKey: 'test-key',
  openrouterBaseUrl: 'https://api.deepseek.com/v1',
  openrouterModel: 'deepseek-chat',
  spoilerProtection: true,
  maxContextChunks: 10,
  indexingMode: 'on-demand' as const,
};

const mockModel = { id: 'test-model' };
const mockProvider = {
  getModel: () => mockModel,
};

describe('llmProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReturnValue({
      settings: { aiSettings: DEFAULT_AI_SETTINGS },
    });
    mockGetAIProvider.mockReturnValue(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Metadata ---

  it('has correct provider metadata', () => {
    expect(llmProvider.name).toBe('llm');
    expect(llmProvider.label).toBe('LLM');
    expect(llmProvider.authRequired).toBe(false);
    expect(llmProvider.quotaExceeded).toBe(false);
  });

  // --- Empty input ---

  it('returns empty array for empty input', async () => {
    const result = await llmProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('returns original text for whitespace-only strings', async () => {
    const result = await llmProvider.translate(['   ', ''], 'en', 'fr');
    expect(result).toEqual(['   ', '']);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  // --- Single text translation ---

  it('translates a single text without delimiter logic', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Bonjour' });

    const result = await llmProvider.translate(['Hello'], 'en', 'fr');

    expect(result).toEqual(['Bonjour']);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);

    // Verify the prompt does NOT contain the delimiter instruction
    const callArg = mockGenerateText.mock.calls[0]![0] as { prompt: string };
    expect(callArg.prompt).not.toContain('@@@DELIM@@@');
  });

  // --- Batch translation ---

  it('translates multiple texts using delimiter batching', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Bonjour\n@@@DELIM@@@\nMonde',
    });

    const result = await llmProvider.translate(['Hello', 'World'], 'en', 'fr');

    expect(result).toEqual(['Bonjour', 'Monde']);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);

    // Verify the prompt contains the delimiter
    const callArg = mockGenerateText.mock.calls[0]![0] as { prompt: string };
    expect(callArg.prompt).toContain('@@@DELIM@@@');
  });

  // --- Fallback: split count mismatch ---

  it('falls back to per-text translation when split count mismatches', async () => {
    // First call (batch): returns wrong number of segments
    mockGenerateText
      .mockResolvedValueOnce({ text: 'Bonjour\n@@@DELIM@@@\nMonde\n@@@DELIM@@@\nExtra' })
      // Fallback per-text calls
      .mockResolvedValueOnce({ text: 'Bonjour' })
      .mockResolvedValueOnce({ text: 'Monde' });

    const result = await llmProvider.translate(['Hello', 'World'], 'en', 'fr');

    expect(result).toEqual(['Bonjour', 'Monde']);
    // 1 batch call + 2 per-text fallback calls = 3 total
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  // --- Fallback: per-text also fails ---

  it('returns original text when per-text fallback also fails', async () => {
    mockGenerateText
      .mockResolvedValueOnce({ text: 'garbage' }) // batch: wrong count
      .mockRejectedValueOnce(new Error('API error')) // per-text 1 fails
      .mockRejectedValueOnce(new Error('API error')); // per-text 2 fails

    const result = await llmProvider.translate(['Hello', 'World'], 'en', 'fr');

    expect(result).toEqual(['Hello', 'World']);
  });

  // --- Not configured ---

  it('throws when AI is not enabled', async () => {
    mockGetState.mockReturnValue({
      settings: { aiSettings: { ...DEFAULT_AI_SETTINGS, enabled: false } },
    });

    await expect(llmProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'AI is not configured',
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('throws when API key is missing for non-ollama provider', async () => {
    mockGetState.mockReturnValue({
      settings: {
        aiSettings: {
          ...DEFAULT_AI_SETTINGS,
          provider: 'openrouter',
          openrouterApiKey: undefined,
        },
      },
    });

    await expect(llmProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'AI is not configured',
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('does not throw when ollama provider has no API key', async () => {
    mockGetState.mockReturnValue({
      settings: {
        aiSettings: {
          ...DEFAULT_AI_SETTINGS,
          provider: 'ollama',
          openrouterApiKey: undefined,
        },
      },
    });

    mockGenerateText.mockResolvedValue({ text: 'Bonjour' });

    const result = await llmProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);
  });

  // --- Empty LLM response ---

  it('returns original text when LLM returns empty response', async () => {
    mockGenerateText.mockResolvedValue({ text: '' });

    const result = await llmProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  // --- Language name mapping ---

  it('uses "the source language" for AUTO source', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Bonjour' });

    await llmProvider.translate(['Hello'], 'AUTO', 'fr');

    const callArg = mockGenerateText.mock.calls[0]![0] as { system: string };
    expect(callArg.system).toContain('the source language');
  });

  it('maps language codes to readable names in the prompt', async () => {
    mockGenerateText.mockResolvedValue({ text: '你好' });

    await llmProvider.translate(['Hello'], 'en', 'zh');

    const callArg = mockGenerateText.mock.calls[0]![0] as { system: string };
    expect(callArg.system).toContain('English');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/__tests__/services/translators/providers/llm.test.ts`
Expected: FAIL — `llm.ts` module does not exist yet.

---

### Task 2: Implement the LLM provider

**Files:**
- Create: `src/services/translators/providers/llm.ts`

- [ ] **Step 1: Create the provider implementation**

```typescript
import { generateText } from 'ai';
import { getAIProvider } from '@/services/ai/providers';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { stubTranslation as _ } from '@/utils/misc';
import { TRANSLATOR_LANGS } from '@/services/constants';
import type { TranslationProvider } from '../types';

const DELIMITER = '@@@DELIM@@@';
const BATCH_DELIMITER = `\n${DELIMITER}\n`;

function getLangName(langCode: string): string {
  if (!langCode || langCode.toUpperCase() === 'AUTO') {
    return 'the source language';
  }
  const shortCode = langCode.toLowerCase().split('-')[0]!;
  return TRANSLATOR_LANGS[shortCode] || langCode;
}

function isAIConfigured(aiSettings: typeof DEFAULT_AI_SETTINGS): boolean {
  if (!aiSettings.enabled) return false;
  if (aiSettings.provider === 'ollama') return true;
  if (aiSettings.provider === 'ai-gateway') return !!aiSettings.aiGatewayApiKey;
  if (aiSettings.provider === 'openrouter') return !!aiSettings.openrouterApiKey;
  return false;
}

export const llmProvider: TranslationProvider = {
  name: 'llm',
  label: _('LLM'),
  authRequired: false,
  quotaExceeded: false,

  translate: async (texts, sourceLang, targetLang) => {
    if (!texts.length) return [];

    // Separate empty/whitespace-only texts from real content
    const indices: number[] = [];
    const nonEmptyTexts: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i]!.trim()) {
        indices.push(i);
        nonEmptyTexts.push(texts[i]!);
      }
    }
    if (nonEmptyTexts.length === 0) return [...texts];

    // Read AI settings from the store
    const { settings } = useSettingsStore.getState();
    const aiSettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;

    if (!isAIConfigured(aiSettings)) {
      throw new Error('AI is not configured. Please configure AI settings first.');
    }

    const aiProvider = getAIProvider(aiSettings);
    const model = aiProvider.getModel();

    const sourceLangName = getLangName(sourceLang);
    const targetLangName = getLangName(targetLang);

    // Single text: skip delimiter logic
    if (nonEmptyTexts.length === 1) {
      const system = `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}. Output ONLY the translation — no explanations, no extra text.`;
      try {
        const result = await generateText({ model, system, prompt: nonEmptyTexts[0]! });
        const translated = result.text?.trim() || nonEmptyTexts[0]!;
        const results = [...texts];
        results[indices[0]!] = translated;
        return results;
      } catch {
        return [...texts];
      }
    }

    // Batch: join with delimiter
    const system = `You are a professional translator. Translate the following text segments from ${sourceLangName} to ${targetLangName}. The segments are separated by a special delimiter line: ${DELIMITER}. Translate each segment and separate the translations with the same delimiter. Output ONLY the translations with delimiters — no explanations, no numbering, no extra text.`;
    const batchedInput = nonEmptyTexts.join(BATCH_DELIMITER);

    try {
      const result = await generateText({ model, system, prompt: batchedInput });
      const translatedSegments = result.text
        .split(DELIMITER)
        .map((s) => s.trim());

      if (translatedSegments.length === nonEmptyTexts.length) {
        const results = [...texts];
        indices.forEach((originalIndex, i) => {
          results[originalIndex] = translatedSegments[i] || nonEmptyTexts[i]!;
        });
        return results;
      }

      // Fallback: per-text translation
      const perTextResults = await Promise.all(
        nonEmptyTexts.map(async (text) => {
          try {
            const singleSystem = `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}. Output ONLY the translation — no explanations, no extra text.`;
            const r = await generateText({ model, system: singleSystem, prompt: text });
            return r.text?.trim() || text;
          } catch {
            return text;
          }
        }),
      );

      const results = [...texts];
      indices.forEach((originalIndex, i) => {
        results[originalIndex] = perTextResults[i]!;
      });
      return results;
    } catch {
      return [...texts];
    }
  },
};
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test -- src/__tests__/services/translators/providers/llm.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 3: Commit**

```bash
git add src/services/translators/providers/llm.ts src/__tests__/services/translators/providers/llm.test.ts
git commit -m "feat: add LLM translation provider with batch and fallback support"
```

---

### Task 3: Update default values in constants.ts

**Files:**
- Modify: `src/services/constants.ts` (lines 23, 253, 432)

- [ ] **Step 1: Change `aiSettings.enabled` default to `true`**

In `src/services/constants.ts`, find the `DEFAULT_AI_SETTINGS` object (around line 22):

```diff
 export const DEFAULT_AI_SETTINGS: AISettings = {
-  enabled: false,
+  enabled: true,
```

- [ ] **Step 2: Change `DEFAULT_READSETTINGS.translationProvider` to `'google'`**

Around line 253:

```diff
 export const DEFAULT_READSETTINGS: ReadSettings = {
   sideBarWidth: '15%',
   isSideBarPinned: true,
   notebookWidth: '25%',
   isNotebookPinned: false,
   notebookActiveTab: 'notes',
   autohideCursor: true,
-  translationProvider: 'deepl',
+  translationProvider: 'google',
```

- [ ] **Step 3: Change `DEFAULT_TRANSLATOR_CONFIG.translationProvider` to `'google'`**

Around line 432:

```diff
 export const DEFAULT_TRANSLATOR_CONFIG: TranslatorConfig = {
   translationEnabled: false,
-  translationProvider: 'deepl',
+  translationProvider: 'google',
```

- [ ] **Step 4: Commit**

```bash
git add src/services/constants.ts
git commit -m "feat: default aiSettings.enabled to true, default translation provider to google"
```

---

### Task 4: Remove AI panel production gate

**Files:**
- Modify: `src/components/settings/SettingsDialog.tsx` (line 118)

- [ ] **Step 1: Remove the `disabled` property from the AI tab**

```diff
     {
       tab: 'AI',
       icon: PiRobot,
       label: _('AI Assistant'),
-      disabled: process.env.NODE_ENV === 'production',
     },
```

- [ ] **Step 2: Commit**

```bash
git add src/components/settings/SettingsDialog.tsx
git commit -m "feat: enable AI settings panel in production builds"
```

---

### Task 5: Remove quota system from useTranslator

**Files:**
- Modify: `src/hooks/useTranslator.ts` (lines 17, 145-154)

- [ ] **Step 1: Change default provider from `'deepl'` to `'google'`**

Line 17:

```diff
 export function useTranslator({
-  provider = 'deepl',
+  provider = 'google',
```

- [ ] **Step 2: Remove the quota-exceeded catch block**

Lines 144-157:

```diff
       } catch (err) {
-        if (err instanceof Error && err.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
-          eventDispatcher.dispatch('toast', {
-            timeout: 5000,
-            message: _(
-              'Daily translation quota reached. Upgrade your plan to continue using AI translations.',
-            ),
-            type: 'error',
-          });
-          setSelectedProvider('azure');
-        }
         setLoading(false);
         throw err instanceof Error ? err : new Error(String(err));
       }
```

- [ ] **Step 3: Remove unused imports**

Remove `ErrorCodes` from the import on line 4 if it is no longer used elsewhere in the file. Check: `ErrorCodes` is only used in the removed catch block. Remove it:

```diff
 import {
-  ErrorCodes,
   getTranslator,
   getTranslators,
   isTranslatorAvailable,
   TranslatorName,
 } from '@/services/translators';
```

Also remove `eventDispatcher` import if no longer used:

```diff
-import { eventDispatcher } from '@/utils/event';
```

Check: `eventDispatcher` is only used in the removed catch block. Remove it.

Also remove `useTranslation` import and `_` declaration since `_` is only used in the removed catch block's toast message:

```diff
-import { useTranslation } from './useTranslation';
```

```diff
-  const _ = useTranslation();
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useTranslator.ts
git commit -m "refactor: remove translation quota system from useTranslator"
```

---

### Task 6: Remove quota utilities from utils.ts

**Files:**
- Modify: `src/services/translators/utils.ts` (lines 5-27)
- Modify: `src/utils/access.ts` (lines 6, 110)

- [ ] **Step 1: Remove `DAILY_USAGE_KEY`, `saveDailyUsage`, and `getDailyUsage`**

Delete lines 5-27 (the `DAILY_USAGE_KEY` constant, `saveDailyUsage` function, and `getDailyUsage` function). Keep `isTranslationAvailable`:

```typescript
import { Book } from '@/types/book';
import { isSameLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

export const isTranslationAvailable = (book?: Book | null, targetLanguage?: string | null) => {
  if (!book || book.format === 'PDF') {
    return false;
  }

  const primaryLanguage = book.primaryLanguage || '';
  if (!primaryLanguage || primaryLanguage.toLowerCase() === 'und') {
    return false;
  }

  if (targetLanguage && isSameLang(primaryLanguage, targetLanguage)) {
    return false;
  }

  if (!targetLanguage && isSameLang(primaryLanguage, getLocale())) {
    return false;
  }

  return true;
};
```

- [ ] **Step 2: Fix `access.ts` — remove `getDailyUsage` import**

`src/utils/access.ts` line 6 imports `getDailyUsage` from `@/services/translators/utils`. Since we just deleted that function, update `access.ts`:

Remove the import (line 6):

```diff
-import { getDailyUsage } from '@/services/translators/utils';
```

Update `getTranslationPlanData` (line 110) to not use `getDailyUsage`:

```diff
 export const getTranslationPlanData = (token: string) => {
   const data = jwtDecode<Token>(token) || {};
   const plan: UserPlan = data['plan'] || 'free';
-  const usage = getDailyUsage() || 0;
+  const usage = 0;
   const quota = getTranslationQuota(plan);
```

This keeps the function's interface intact (still returns `{ plan, usage, quota }`) while removing the dependency on the deleted utility. `useQuotaStats` and other consumers continue to work — translation usage simply always reports 0, which is correct since the quota system is removed.

- [ ] **Step 3: Commit**

```bash
git add src/services/translators/utils.ts
git commit -m "refactor: remove daily translation usage tracking utilities"
```

---

### Task 7: Register LLM provider and remove old providers

**Files:**
- Modify: `src/services/translators/providers/index.ts`
- Delete: `src/services/translators/providers/deepl.ts`
- Delete: `src/services/translators/providers/azure.ts`
- Delete: `src/services/translators/providers/yandex.ts`
- Delete: `src/pages/api/deepl/translate.ts`

- [ ] **Step 1: Rewrite the provider registry**

Replace the entire content of `src/services/translators/providers/index.ts`:

```typescript
import { TranslationProvider } from '../types';
import { googleProvider } from './google';
import { llmProvider } from './llm';

function createTranslator<T extends string>(
  name: T,
  implementation: TranslationProvider,
): TranslationProvider & { name: T } {
  if (name !== implementation.name) {
    throw Error(
      `Translator name "${name}" does not match implementation name "${implementation.name}"`,
    );
  }
  return implementation as TranslationProvider & { name: T };
}

const googleTranslator = createTranslator('google', googleProvider);
const llmTranslator = createTranslator('llm', llmProvider);

const availableTranslators = [
  googleTranslator,
  llmTranslator,
];

export type TranslatorName = (typeof availableTranslators)[number]['name'];

export const getTranslator = (name: TranslatorName): TranslationProvider | undefined => {
  return availableTranslators.find((translator) => translator.name === name);
};

export const getTranslators = (): TranslationProvider[] => {
  return availableTranslators;
};

export const isTranslatorAvailable = (
  translator: TranslationProvider,
  hasToken: boolean,
): boolean => {
  if (translator.disabled) return false;
  if (translator.quotaExceeded) return false;
  if (translator.authRequired && !hasToken) return false;
  return true;
};

export const getTranslatorDisplayLabel = (
  translator: TranslationProvider,
  hasToken: boolean,
  _: (key: string) => string,
): string => {
  if (translator.disabled) {
    return `${translator.label}`;
  }
  if (translator.authRequired && !hasToken) {
    return `${translator.label} (${_('Login Required')})`;
  }
  if (translator.quotaExceeded) {
    return `${translator.label} (${_('Quota Exceeded')})`;
  }
  return translator.label;
};
```

- [ ] **Step 2: Delete the old provider files**

```bash
rm src/services/translators/providers/deepl.ts
rm src/services/translators/providers/azure.ts
rm src/services/translators/providers/yandex.ts
rm src/pages/api/deepl/translate.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/services/translators/providers/index.ts
git rm src/services/translators/providers/deepl.ts src/services/translators/providers/azure.ts src/services/translators/providers/yandex.ts src/pages/api/deepl/translate.ts
git commit -m "refactor: remove DeepL/Azure/Yandex providers, register LLM provider"
```

---

### Task 8: Update existing provider tests

**Files:**
- Modify: `src/__tests__/services/translators/providers.test.ts`

- [ ] **Step 1: Remove deleted provider test blocks**

Remove the entire `describe('yandexProvider', ...)` block (lines 136-232) and the entire `describe('azureProvider', ...)` block (lines 237-330).

Remove the supabase mock (lines 50-55) since it was only needed for the DeepL import chain:

```diff
-vi.mock('@/utils/supabase', () => ({
-  supabase: {
-    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
-    from: vi.fn(),
-  },
-}));
```

- [ ] **Step 2: Update the provider registry tests**

Replace the registry test block (lines 335-383) to reference `llm` instead of `yandex`:

```typescript
// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------
describe('provider registry', () => {
  it('includes google in getTranslators()', async () => {
    const { getTranslators } = await import('@/services/translators/providers');
    const names = getTranslators().map((t) => t.name);
    expect(names).toContain('google');
  });

  it('includes llm in getTranslators()', async () => {
    const { getTranslators } = await import('@/services/translators/providers');
    const names = getTranslators().map((t) => t.name);
    expect(names).toContain('llm');
  });

  it('isTranslatorAvailable returns true for google without token', async () => {
    const { getTranslator, isTranslatorAvailable } = await import(
      '@/services/translators/providers'
    );
    const google = getTranslator('google')!;
    expect(isTranslatorAvailable(google, false)).toBe(true);
    expect(isTranslatorAvailable(google, true)).toBe(true);
  });

  it('isTranslatorAvailable returns true for llm without token', async () => {
    const { getTranslator, isTranslatorAvailable } = await import(
      '@/services/translators/providers'
    );
    const llm = getTranslator('llm')!;
    expect(isTranslatorAvailable(llm, false)).toBe(true);
    expect(isTranslatorAvailable(llm, true)).toBe(true);
  });

  it('isTranslatorAvailable returns false for authRequired without token', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const authed = { name: 'x', label: 'X', authRequired: true, translate: async () => [] };
    expect(isTranslatorAvailable(authed, false)).toBe(false);
    expect(isTranslatorAvailable(authed, true)).toBe(true);
  });

  it('isTranslatorAvailable returns false when quota is exceeded', async () => {
    const { isTranslatorAvailable } = await import('@/services/translators/providers');
    const exhausted = { name: 'x', label: 'X', quotaExceeded: true, translate: async () => [] };
    expect(isTranslatorAvailable(exhausted, true)).toBe(false);
  });

  it('getTranslatorDisplayLabel returns the plain label for healthy providers', async () => {
    const { getTranslator, getTranslatorDisplayLabel } = await import(
      '@/services/translators/providers'
    );
    const google = getTranslator('google')!;
    expect(getTranslatorDisplayLabel(google, true, (s) => s)).toBe('Google Translate');
  });
});
```

- [ ] **Step 3: Run all translator tests**

Run: `pnpm test -- src/__tests__/services/translators/`
Expected: PASS — all tests green, no references to deleted providers.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/services/translators/providers.test.ts
git commit -m "test: update provider tests for google + llm registry"
```

---

### Task 9: Verify build and typecheck

- [ ] **Step 1: Run typecheck**

Run: `pnpm lint`
Expected: PASS — no type errors, no references to deleted modules.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS — all tests green.

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: PASS — build succeeds without errors.

- [ ] **Step 4: Commit if any fixes were needed**

If any files were modified to fix type errors or test failures:

```bash
git add -A
git commit -m "fix: resolve type errors and test failures from provider migration"
```
