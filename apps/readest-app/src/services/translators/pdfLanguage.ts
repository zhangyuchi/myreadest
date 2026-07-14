import { detectLanguage } from '@/services/translators/providers/llm';
import { isSameLang, isValidLang } from '@/utils/lang';

export type PDFLanguageProvenance = 'metadata' | 'detected' | 'fallback';

export interface PDFSourceLanguage {
  language: string;
  provenance: PDFLanguageProvenance;
  skipTranslation: boolean;
}

interface ResolvePDFSourceLanguageInput {
  metadataLanguage?: string | null;
  targetLanguage: string;
  sample: string;
  detect?: (text: string) => Promise<string>;
}

const normalizeLanguage = (language: string): string | null => {
  const normalized = language.trim().toLowerCase();
  return isValidLang(normalized) ? normalized : null;
};

export async function resolvePDFSourceLanguage({
  metadataLanguage,
  targetLanguage,
  sample,
  detect = detectLanguage,
}: ResolvePDFSourceLanguageInput): Promise<PDFSourceLanguage> {
  const metadata = normalizeLanguage(metadataLanguage ?? '');
  if (metadata) {
    return {
      language: metadata,
      provenance: 'metadata',
      skipTranslation: isSameLang(metadata, targetLanguage),
    };
  }

  try {
    const detected = normalizeLanguage(await detect(sample));
    if (detected) {
      return {
        language: detected,
        provenance: 'detected',
        skipTranslation: isSameLang(detected, targetLanguage),
      };
    }
  } catch (error) {
    console.warn('PDF language detection failed; continuing with AUTO.', error);
  }

  return { language: 'AUTO', provenance: 'fallback', skipTranslation: false };
}
