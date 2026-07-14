import { describe, expect, it, vi } from 'vitest';
import { resolvePDFSourceLanguage } from '@/services/translators/pdfLanguage';

// All cases inject a detector; isolate the unused production default from
// configuration-only application dependencies during module evaluation.
vi.mock('@/services/translators/providers/llm', () => ({
  detectLanguage: vi.fn(),
}));

describe('resolvePDFSourceLanguage', () => {
  it('trusts metadata and bypasses detection', async () => {
    const detect = vi.fn();
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: 'fr',
      targetLanguage: 'zh-CN',
      sample: 'Bonjour',
      detect,
    });

    expect(result).toEqual({ language: 'fr', provenance: 'metadata', skipTranslation: false });
    expect(detect).not.toHaveBeenCalled();
  });

  it('skips only after a successful same-language detection', async () => {
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: 'und',
      targetLanguage: 'en-US',
      sample: 'Hello',
      detect: vi.fn().mockResolvedValue('en'),
    });

    expect(result).toEqual({ language: 'en', provenance: 'detected', skipTranslation: true });
  });

  it('ignores malformed metadata and uses successful detection', async () => {
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: 'English',
      targetLanguage: 'zh-CN',
      sample: 'Bonjour',
      detect: vi.fn().mockResolvedValue('fr'),
    });

    expect(result).toEqual({ language: 'fr', provenance: 'detected', skipTranslation: false });
  });

  it.each([
    ['und', vi.fn().mockResolvedValue('und')],
    ['invalid output', vi.fn().mockResolvedValue('English')],
    ['provider failure', vi.fn().mockRejectedValue(new Error('offline'))],
  ])('falls back to AUTO for %s and still permits translation', async (_name, detect) => {
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: '',
      targetLanguage: 'en',
      sample: '未知语言',
      detect,
    });

    expect(result).toEqual({ language: 'AUTO', provenance: 'fallback', skipTranslation: false });
  });
});
