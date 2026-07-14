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
