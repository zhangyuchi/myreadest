# LLM Translation Provider Design

**Date**: 2026-07-13
**Status**: Approved (pending spec review)

## Overview

Add an LLM-based translation provider to Readest's translation system, allowing users to translate books using their own LLM API (e.g., DeepSeek, OpenAI, or any OpenAI-compatible endpoint). The design reuses the existing AI service infrastructure, removes the translation quota/premium gating, and enables the AI settings panel in production builds.

## Motivation

- The current translation providers (DeepL, Azure, Google, Yandex) are server-side services with daily quotas tied to subscription plans.
- Users want to use their own LLM API keys (especially DeepSeek) for translation, which is cheaper and higher quality for many language pairs.
- The AI settings panel is disabled in production builds, preventing users from configuring LLM providers.
- The translation quota system restricts free users to 10KB/day, which is too limiting.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config reuse strategy | Fully reuse `aiSettings` | No new config fields; user configures once in AI settings |
| Batch translation strategy | Delimiter-based batching | Token-efficient, simple parsing, works with all LLMs |
| Provider visibility | Always visible in dropdown | User can select LLM anytime; prompted to configure if not ready |
| Production gate | Remove restriction | All users can access AI settings |
| `aiSettings.enabled` default | `true` | AI is on by default; users can disable if unwanted |
| Remove premium/quota | Yes | Translation no longer gated by subscription plan or daily limits |
| Remove DeepL/Azure/Yandex | Yes | Only Google (free) and LLM (user's API key) remain |

## Architecture

### Data Flow

```
User selects "LLM" in translation provider dropdown
  -> useTranslator hook calls llmProvider.translate(texts, srcLang, tgtLang)
  -> llmProvider reads aiSettings from useSettingsStore.getState()
  -> getAIProvider(aiSettings) -> OpenRouterProvider / AIGatewayProvider / OllamaProvider
  -> provider.getModel() -> LanguageModel (Vercel AI SDK)
  -> generateText({ model, system: translationPrompt, prompt: batchedTexts })
  -> split response by delimiter -> return string[]
```

### Key Properties

- **No new config fields**: Translation reads `aiSettings` directly (provider, apiKey, model).
- **No new UI components**: Translation dropdown is driven by `getTranslators()`; registration is sufficient.
- **`authRequired: false`**: LLM provider does not require app login token; API key lives in `aiSettings`.
- **`quotaExceeded: false`**: No quota tracking; LLM call costs are borne by the user's own API key.

## Component Design

### 1. New Provider: `src/services/translators/providers/llm.ts`

Implements the `TranslationProvider` interface.

```typescript
import { generateText } from 'ai';
import { getAIProvider } from '@/services/ai/providers';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { stubTranslation as _ } from '@/utils/misc';
import { TRANSLATOR_LANGS } from '@/services/constants';
import type { TranslationProvider } from '../types';

const BATCH_DELIMITER = '\n@@@DELIM@@@\n';

export const llmProvider: TranslationProvider = {
  name: 'llm',
  label: _('LLM'),
  authRequired: false,
  quotaExceeded: false,

  translate: async (texts, sourceLang, targetLang) => {
    // 1. Read aiSettings from settings store
    // 2. Check if configured (has apiKey for non-ollama, or is ollama)
    // 3. Get AI provider + model via getAIProvider(aiSettings)
    // 4. Build translation prompt with language names
    // 5. If single text: skip delimiter, translate directly
    // 6. If multiple texts: join with BATCH_DELIMITER, single generateText call
    // 7. Split response by delimiter
    // 8. If split count != input count: fallback to per-text translation
    // 9. Return string[]
  },
};
```

#### Prompt Design

```
System:
You are a professional translator. Translate the following text segments
from {sourceLangName} to {targetLangName}. The segments are separated by a
special delimiter line: @@@DELIM@@@. Translate each segment and separate
the translations with the same delimiter. Output ONLY the translations with
delimiters -- no explanations, no numbering, no extra text.

User:
{text1}
@@@DELIM@@@
{text2}
@@@DELIM@@@
{text3}
```

#### Language Name Mapping

- `sourceLang` / `targetLang` are short codes (e.g., `EN`, `ZH-CN`, `AUTO`).
- `AUTO` -> "the source language" (let LLM auto-detect).
- Other codes -> mapped to readable names via existing `TRANSLATOR_LANGS` table (e.g., `EN` -> `English`).

#### Single-Text Optimization

When `texts.length === 1` (e.g., TranslatorPopup selection), skip the delimiter logic entirely. Send a simple prompt without the delimiter instructions, avoiding parsing overhead.

#### Fallback Strategy

1. **Split count matches input count** -> return `translatedSegments` directly.
2. **Split count does not match** -> re-translate each text individually via separate `generateText` calls.
3. **Individual translation also fails** -> return original text (consistent with existing provider behavior).

### 2. Provider Registration: `src/services/translators/providers/index.ts`

Only Google and LLM providers remain:

```typescript
import { googleProvider } from './google';
import { llmProvider } from './llm';

export const translators = [
  googleProvider,
  llmProvider,
];
```

`TranslatorName` type auto-derives to `'google' | 'llm'`. `getTranslators()` returns both, dropdown auto-populates.

### 3. Remove Production Gate: `src/components/settings/SettingsDialog.tsx`

```diff
     {
       tab: 'AI',
       icon: PiRobot,
       label: _('AI Assistant'),
-      disabled: process.env.NODE_ENV === 'production',
     },
```

### 4. Default Values: `src/services/constants.ts`

#### 4.1 `aiSettings.enabled` default to `true`

```diff
 export const DEFAULT_AI_SETTINGS: AISettings = {
-  enabled: false,
+  enabled: true,
```

#### 4.2 Default translation provider to `google`

```diff
 export const DEFAULT_READSETTINGS: ReadSettings = {
-  translationProvider: 'deepl',
+  translationProvider: 'google',
```

```diff
 export const DEFAULT_TRANSLATOR_CONFIG: TranslatorConfig = {
-  translationProvider: 'deepl',
+  translationProvider: 'google',
```

### 5. Remove Translation Quota System

#### 5.1 `src/hooks/useTranslator.ts`

Remove the quota-exceeded catch block and DeepL provider import:

```diff
       } catch (err) {
-        if (err instanceof Error && err.message.includes(ErrorCodes.DAILY_QUOTA_EXCEEDED)) {
-          eventDispatcher.dispatch('toast', {
-            timeout: 5000,
-            message: _('Daily translation quota reached. Upgrade your plan...'),
-            type: 'error',
-          });
-          setSelectedProvider('azure');
-        }
         setLoading(false);
         throw err instanceof Error ? err : new Error(String(err));
       }
```

#### 5.2 `src/services/translators/utils.ts`

Remove `saveDailyUsage`, `getDailyUsage`, and `DAILY_USAGE_KEY`.

#### 5.3 `src/pages/api/deepl/translate.ts`

Delete the entire file. DeepL provider is removed; this endpoint is no longer called.

### 6. Delete Removed Providers

| File | Action |
|------|--------|
| `src/services/translators/providers/deepl.ts` | Delete |
| `src/services/translators/providers/azure.ts` | Delete |
| `src/services/translators/providers/yandex.ts` | Delete |

### 7. Out of Scope (Not Changed)

- `src/utils/access.ts`: `getTranslationQuota`, `getTranslationPlanData`, `getDailyTranslationPlanData` -- may be referenced by `useQuotaStats` and other UI; not modified in this change.
- `DEFAULT_DAILY_TRANSLATION_QUOTA` constant -- retained but no longer used by translation flow.
- `ErrorCodes.DAILY_QUOTA_EXCEEDED` -- constant retained; translation flow no longer triggers it.
- Storage quota system -- unrelated to translation.

## Error Handling

| Scenario | Handling |
|----------|----------|
| AI not configured (no apiKey, not ollama) | Throw `"AI is not configured. Please configure AI settings first."` |
| AI provider init failure (network) | Exception propagates; `useTranslator` catch block handles |
| LLM returns empty response | Return original text |
| Batch split count mismatch | Fallback to per-text translation |
| Per-text translation also fails | Return original text |
| `generateText` timeout | Relies on Vercel AI SDK built-in timeout |

## Testing

### Unit Tests: `src/__tests__/services/translators/providers/llm.test.ts`

1. **Single text translation**: mock `generateText`, verify prompt construction and result return.
2. **Batch translation**: mock `generateText`, verify delimiter join and split.
3. **Fallback**: mock `generateText` returning mismatched segment count, verify per-text retry.
4. **Not configured**: `aiSettings.enabled` is true but no apiKey (non-ollama), verify error thrown.
5. **Empty text**: pass empty array or whitespace-only strings, verify LLM not called.

### Mock Strategy

- `vi.mock('ai')` to mock `generateText`.
- `vi.mock('@/store/settingsStore')` to mock `useSettingsStore.getState()`.
- `vi.mock('@/services/ai/providers')` to mock `getAIProvider`.

## File Change Summary

| Operation | File |
|-----------|------|
| Create | `src/services/translators/providers/llm.ts` |
| Create | `src/__tests__/services/translators/providers/llm.test.ts` |
| Modify | `src/services/translators/providers/index.ts` |
| Modify | `src/services/constants.ts` |
| Modify | `src/components/settings/SettingsDialog.tsx` |
| Modify | `src/hooks/useTranslator.ts` |
| Modify | `src/services/translators/utils.ts` |
| Delete | `src/services/translators/providers/deepl.ts` |
| Delete | `src/services/translators/providers/azure.ts` |
| Delete | `src/services/translators/providers/yandex.ts` |
| Delete | `src/pages/api/deepl/translate.ts` |

## DeepSeek Configuration Example

After implementation, users configure DeepSeek for translation as follows:

1. Open Settings -> AI Assistant tab.
2. Select "OpenAI Compatible" as provider.
3. Set Base URL to `https://api.deepseek.com/v1`.
4. Enter DeepSeek API key.
5. Set Model to `deepseek-chat` (or click refresh to auto-fetch model list).
6. Open Settings -> Language tab.
7. Select "LLM" as translation provider.
8. Translation now uses DeepSeek via the user's API key.
