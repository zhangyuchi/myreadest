import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';

const mocks = vi.hoisted(() => ({
  detectLanguage: vi.fn(),
  translate: vi.fn(),
  setIsLoading: vi.fn(),
  settings: {
    translationEnabled: true,
    translationProvider: 'google',
    translateTargetLang: 'zh-CN',
    showTranslateSource: true,
  },
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({ translate: mocks.translate }),
}));
vi.mock('@/services/translators/providers/llm', () => ({
  detectLanguage: mocks.detectLanguage,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({
      getViewSettings: () => mocks.settings,
      setIsLoading: mocks.setIsLoading,
    }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: { primaryLanguage: 'und' } }) }),
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => null,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (text: string) => text,
}));

class ImmediateIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  disconnect() {}

  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);

const Harness = ({ view }: { view: HTMLElement }) => {
  useTextTranslation('book-1', view);
  return null;
};

describe('useTextTranslation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.detectLanguage.mockRejectedValue(new Error('LLM detector unavailable'));
    mocks.translate.mockResolvedValue(['EPUB translation']);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('translates reflowable EPUB text when unknown metadata has no available LLM detector', async () => {
    const view = document.createElement('article');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'EPUB source';
    view.appendChild(paragraph);
    document.body.appendChild(view);

    render(<Harness view={view} />);

    await waitFor(() => expect(mocks.translate).toHaveBeenCalledWith(['EPUB source']));
    await waitFor(() =>
      expect(paragraph.querySelector('.translation-target')?.textContent).toBe('EPUB translation'),
    );
  });
});
