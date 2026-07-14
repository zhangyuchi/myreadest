import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment module
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: vi.fn(() => 'https://api.example.com'),
}));

vi.mock('@/utils/misc', () => ({
  stubTranslation: (s: string) => s,
}));

vi.mock('@/utils/lang', () => ({
  normalizeToShortLang: vi.fn((lang: string) => {
    const map: Record<string, string> = {
      'en-US': 'en',
      'fr-FR': 'fr',
      'zh-CN': 'zh',
      AUTO: 'auto',
      en: 'en',
      fr: 'fr',
      de: 'de',
      zh: 'zh',
      auto: 'auto',
    };
    return map[lang] ?? lang;
  }),
  normalizeToFullLang: vi.fn((lang: string) => {
    const map: Record<string, string> = {
      en: 'en',
      fr: 'fr',
      de: 'de',
      zh: 'zh-Hans',
      auto: 'auto',
    };
    return map[lang] ?? lang;
  }),
}));

// Mock Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Stub Supabase so importing the providers registry (which pulls in
// llm.ts → @/store/settingsStore → @/utils/supabase) doesn't instantiate a
// real GoTrueClient on every `vi.resetModules()` round.
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn(),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Google Translate Provider
// ---------------------------------------------------------------------------
describe('googleProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty input', async () => {
    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate([], 'en', 'fr');
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('translates text array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[['Bonjour', 'Hello']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Bonjour']);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('preserves empty strings in input', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[['translated', 'original']]],
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['', 'Hello'], 'en', 'fr');
    expect(result[0]).toBe('');
    expect(result[1]).toBe('translated');
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    await expect(googleProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
      'Translation failed with status 500',
    );
  });

  it('falls back to original text when response format is unexpected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { googleProvider } = await import('@/services/translators/providers/google');
    const result = await googleProvider.translate(['Hello'], 'en', 'fr');
    expect(result).toEqual(['Hello']);
  });

  it('has correct provider metadata', async () => {
    const { googleProvider } = await import('@/services/translators/providers/google');
    expect(googleProvider.name).toBe('google');
    expect(googleProvider.label).toBe('Google Translate');
  });
});

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
