import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslator } from '@/hooks/useTranslator';

const mocks = vi.hoisted(() => ({
  provider: {
    name: 'llm',
    translate: vi.fn(),
  },
  storeInCache: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: undefined }),
}));
vi.mock('@/services/translators', () => ({
  getTranslator: () => mocks.provider,
  getTranslators: () => [mocks.provider],
  isTranslatorAvailable: () => true,
  getFromCache: vi.fn().mockResolvedValue(null),
  storeInCache: mocks.storeInCache,
  preprocess: (texts: string[]) => texts,
  polish: (texts: string[]) => texts,
}));

describe('useTranslator provider failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.translate.mockRejectedValue(new Error('API offline'));
  });

  it('propagates rejection and does not cache failed output', async () => {
    const { result } = renderHook(() =>
      useTranslator({
        provider: 'llm',
        sourceLang: 'en',
        targetLang: 'zh-CN',
        enablePolishing: false,
        enablePreprocessing: false,
      }),
    );

    await act(async () => {
      await expect(result.current.translate(['Hello'])).rejects.toThrow('API offline');
    });
    expect(mocks.storeInCache).not.toHaveBeenCalled();
  });
});
