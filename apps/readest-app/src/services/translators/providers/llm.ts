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

function requireTranslationText(text: string | undefined): string {
  const translated = text?.trim();
  if (!translated) {
    throw new Error('Translation returned an empty response.');
  }
  return translated;
}

function isAIConfigured(aiSettings: typeof DEFAULT_AI_SETTINGS): boolean {
  if (!aiSettings.enabled) return false;
  if (aiSettings.provider === 'ollama') return true;
  if (aiSettings.provider === 'ai-gateway') return !!aiSettings.aiGatewayApiKey;
  if (aiSettings.provider === 'openrouter') return !!aiSettings.openrouterApiKey;
  return false;
}

export async function detectLanguage(text: string): Promise<string> {
  const { settings } = useSettingsStore.getState();
  const aiSettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;

  if (!isAIConfigured(aiSettings)) {
    return 'und';
  }

  const aiProvider = getAIProvider(aiSettings);
  const model = aiProvider.getModel();

  const system =
    'Identify the language of the following text. Respond with ONLY the ISO 639-1 two-letter language code (e.g., "en" for English, "zh" for Chinese, "fr" for French, "ja" for Japanese, "ko" for Korean). If you cannot determine the language, respond with "und".';

  try {
    const result = await generateText({ model, system, prompt: text });
    const code = result.text?.trim().toLowerCase() || 'und';
    if (code === 'und' || code.length < 2) return 'und';
    return code.split('-')[0]!;
  } catch {
    return 'und';
  }
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
      const result = await generateText({ model, system, prompt: nonEmptyTexts[0]! });
      const results = [...texts];
      results[indices[0]!] = requireTranslationText(result.text);
      return results;
    }

    // Batch: join with delimiter
    const system = `You are a professional translator. Translate the following text segments from ${sourceLangName} to ${targetLangName}. The segments are separated by a special delimiter line: ${DELIMITER}. Translate each segment and separate the translations with the same delimiter. Output ONLY the translations with delimiters — no explanations, no numbering, no extra text.`;
    const batchedInput = nonEmptyTexts.join(BATCH_DELIMITER);

    const result = await generateText({ model, system, prompt: batchedInput });
    const translatedSegments = result.text.split(DELIMITER).map((segment) => segment.trim());

    if (
      translatedSegments.length === nonEmptyTexts.length &&
      translatedSegments.every((segment) => segment.length > 0)
    ) {
      const results = [...texts];
      indices.forEach((originalIndex, index) => {
        results[originalIndex] = translatedSegments[index]!;
      });
      return results;
    }

    const perTextResults = await Promise.all(
      nonEmptyTexts.map(async (text) => {
        const singleSystem = `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}. Output ONLY the translation — no explanations, no extra text.`;
        const singleResult = await generateText({ model, system: singleSystem, prompt: text });
        return requireTranslationText(singleResult.text);
      }),
    );

    const results = [...texts];
    indices.forEach((originalIndex, index) => {
      results[originalIndex] = perTextResults[index]!;
    });
    return results;
  },
};
