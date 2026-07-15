import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';

const mocks = vi.hoisted(() => ({
  translate: vi.fn(),
  useTranslator: vi.fn(),
  resolveLanguage: vi.fn(),
  getSources: vi.fn(),
  progress: { index: 0 },
  settings: {
    translationEnabled: true,
    translationProvider: 'google',
    translateTargetLang: 'zh-CN',
  },
  bookData: { book: { format: 'PDF', primaryLanguage: '' } },
  toast: vi.fn(),
  translateUI: (text: string) => text,
  reader: {
    state: {
      viewStates: {} as Record<string, { viewSettings?: unknown }>,
      getViewSettings: () => mocks.reader.state.viewStates['book-1']?.viewSettings ?? null,
    },
    listeners: new Set<() => void>(),
    setSettings(settings: unknown) {
      this.state = {
        ...this.state,
        viewStates: { 'book-1': { viewSettings: settings } },
      };
      this.listeners.forEach((listener) => listener());
    },
  },
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: mocks.useTranslator,
}));
vi.mock('@/services/translators/pdfLanguage', () => ({
  resolvePDFSourceLanguage: mocks.resolveLanguage,
}));
vi.mock('@/app/reader/utils/pdfTranslation', () => ({
  getVisiblePDFPageSources: mocks.getSources,
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.progress,
}));
vi.mock('@/store/readerStore', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof import('react')>('react');
  return {
    useReaderStore: (selector: (state: typeof mocks.reader.state) => unknown) =>
      useSyncExternalStore(
        (listener) => {
          mocks.reader.listeners.add(listener);
          return () => mocks.reader.listeners.delete(listener);
        },
        () => selector(mocks.reader.state),
        () => selector(mocks.reader.state),
      ),
  };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({ getBookData: () => mocks.bookData }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => mocks.translateUI,
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mocks.toast },
}));

const makeView = () => document.createElement('div') as unknown as FoliateView;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.useTranslator.mockReturnValue({ translate: mocks.translate });
  mocks.progress.index = 0;
  mocks.settings.translationEnabled = true;
  mocks.settings.translationProvider = 'google';
  mocks.settings.translateTargetLang = 'zh-CN';
  mocks.bookData.book.primaryLanguage = '';
  mocks.reader.listeners.clear();
  mocks.reader.setSettings(mocks.settings);
});

describe('usePDFTranslation', () => {
  it('translates with AUTO when detection falls back', async () => {
    mocks.getSources.mockReturnValue([
      { index: 0, paragraphs: ['First body paragraph.', 'Second body paragraph.'] },
    ]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'AUTO',
      provenance: 'fallback',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['第一段。', '第二段。']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() =>
      expect(result.current.pages[0]).toEqual(
        expect.objectContaining({
          status: 'translated',
          translatedParagraphs: ['第一段。', '第二段。'],
        }),
      ),
    );
    expect(mocks.translate).toHaveBeenCalledWith(
      ['First body paragraph.', 'Second body paragraph.'],
      {
        source: 'AUTO',
        target: 'zh-CN',
      },
    );
    expect(result.current.pages[0]?.sourceParagraphs).toEqual([
      'First body paragraph.',
      'Second body paragraph.',
    ]);
  });

  it('publishes an error instead of source text when translation rejects', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Hello PDF'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'detected',
      skipTranslation: false,
    });
    mocks.translate.mockRejectedValue(new Error('API offline'));

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));
    expect(result.current.pages[0]?.error).toBe('API offline');
    expect(result.current.pages[0]?.translatedParagraphs).toBeUndefined();
  });

  it('publishes an error when translation response does not align with source paragraphs', async () => {
    mocks.getSources.mockReturnValue([
      { index: 0, paragraphs: ['First body paragraph.', 'Second body paragraph.'] },
    ]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'detected',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['only one paragraph']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));
    expect(result.current.pages[0]).toEqual(
      expect.objectContaining({
        error: 'Translation did not return one result for each paragraph.',
      }),
    );
    expect(result.current.pages[0]?.translatedParagraphs).toBeUndefined();
  });

  it('ignores a late result after the visible page changes', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, paragraphs: ['First page'] }])
      .mockReturnValue([{ index: 1, paragraphs: ['Second page'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'detected',
      skipTranslation: false,
    });
    mocks.translate
      .mockReturnValueOnce(new Promise<string[]>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(['第二页']);

    const view = makeView();
    const { result, rerender } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(1));
    mocks.progress.index = 1;
    rerender();

    await waitFor(() => expect(result.current.pages[0]?.index).toBe(1));
    await act(async () => resolveFirst(['第一页']));
    expect(result.current.pages).toEqual([
      expect.objectContaining({ index: 1, translatedParagraphs: ['第二页'] }),
    ]);
  });

  it('skips after a trusted same-language detection', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Hello PDF'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'detected',
      skipTranslation: true,
    });

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(result.current.pages).toEqual([]);
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('keeps two spread pages in renderer order', async () => {
    mocks.getSources.mockReturnValue([
      { index: 4, paragraphs: ['Left'] },
      { index: 5, paragraphs: ['Right'] },
    ]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValueOnce(['左页']).mockResolvedValueOnce(['右页']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() =>
      expect(result.current.pages.every((page) => page.status === 'translated')).toBe(true),
    );
    expect(result.current.pages.map((page) => page.index)).toEqual([4, 5]);
  });

  it('refreshes after the PDF text-layer-rendered event', async () => {
    const view = makeView();
    mocks.getSources.mockReturnValueOnce([]).mockReturnValue([{ index: 0, paragraphs: ['Ready'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['就绪']);
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));

    await waitFor(() => expect(result.current.pages[0]?.translatedParagraphs).toEqual(['就绪']));
  });

  it('ignores a pending translation after a newer text-layer refresh', async () => {
    let resolveFirst!: (texts: string[]) => void;
    const view = makeView();
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, paragraphs: ['First layer'] }])
      .mockReturnValue([{ index: 1, paragraphs: ['Second layer'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate
      .mockReturnValueOnce(new Promise<string[]>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(['第二层']);

    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(1));

    act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));
    await waitFor(() => expect(result.current.pages[0]?.translatedParagraphs).toEqual(['第二层']));
    await act(async () => resolveFirst(['第一层']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({ index: 1, translatedParagraphs: ['第二层'] }),
    ]);
  });

  it('ignores pending work after the view is replaced', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, paragraphs: ['First view'] }])
      .mockReturnValue([{ index: 1, paragraphs: ['Replacement view'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate
      .mockReturnValueOnce(new Promise<string[]>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(['替换页']);

    const { result, rerender } = renderHook(({ view }) => usePDFTranslation('book-1', view), {
      initialProps: { view: makeView() },
    });
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(1));

    rerender({ view: makeView() });
    await waitFor(() => expect(result.current.pages[0]?.translatedParagraphs).toEqual(['替换页']));
    await act(async () => resolveFirst(['旧视图']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({ index: 1, translatedParagraphs: ['替换页'] }),
    ]);
  });

  it('removes PDF event listeners during cleanup', async () => {
    const view = makeView();
    const removeEventListener = vi.spyOn(view, 'removeEventListener');
    mocks.getSources.mockReturnValue([]);

    const { unmount } = renderHook(() => usePDFTranslation('book-1', view));
    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('load', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith(
      'pdf-text-layer-rendered',
      expect.any(Function),
    );
  });

  it('retries only the failed page', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Retry me'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['重试成功']);
    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));

    act(() => result.current.retryPage(0));

    await waitFor(() =>
      expect(result.current.pages[0]?.translatedParagraphs).toEqual(['重试成功']),
    );
  });

  it('ignores a pending retry after a newer refresh', async () => {
    let resolveRetry!: (texts: string[]) => void;
    const view = makeView();
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Retry me'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(new Promise<string[]>((resolve) => (resolveRetry = resolve)))
      .mockResolvedValueOnce(['刷新结果']);

    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));

    act(() => result.current.retryPage(0));
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(2));
    act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));
    await waitFor(() =>
      expect(result.current.pages[0]?.translatedParagraphs).toEqual(['刷新结果']),
    );
    await act(async () => resolveRetry(['过期重试']));

    expect(result.current.pages[0]?.translatedParagraphs).toEqual(['刷新结果']);
  });

  it('does not retry translated or translating pages', async () => {
    let resolveTranslation!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Already translating'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockReturnValue(
      new Promise<string[]>((resolve) => (resolveTranslation = resolve)),
    );

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translating'));

    act(() => result.current.retryPage(0));
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    await act(async () => resolveTranslation(['已翻译']));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translated'));

    act(() => result.current.retryPage(0));
    expect(mocks.translate).toHaveBeenCalledTimes(1);
  });

  it('clears state and ignores pending work when translation is disabled', async () => {
    let resolveTranslation!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Pending'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockReturnValue(
      new Promise<string[]>((resolve) => (resolveTranslation = resolve)),
    );
    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translating'));

    act(() => mocks.reader.setSettings({ ...mocks.settings, translationEnabled: false }));
    await waitFor(() => expect(result.current.pages).toEqual([]));
    await act(async () => resolveTranslation(['迟到结果']));

    expect(result.current.pages).toEqual([]);
  });

  it('does not publish a pending translation after unmount', async () => {
    let resolveTranslation!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Pending unmount'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockReturnValue(
      new Promise<string[]>((resolve) => (resolveTranslation = resolve)),
    );

    const view = makeView();
    const { result, unmount } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translating'));
    const pagesBeforeUnmount = result.current.pages;

    unmount();
    await act(async () => resolveTranslation(['Late unmount result']));

    expect(result.current.pages).toEqual(pagesBeforeUnmount);
  });

  it('replaces a pending translation through the reactive provider subscription', async () => {
    let resolveGoogle!: (texts: string[]) => void;
    const googleTranslate = vi.fn(
      () => new Promise<string[]>((resolve) => (resolveGoogle = resolve)),
    );
    const deeplTranslate = vi.fn().mockResolvedValue(['DeepL replacement']);
    mocks.useTranslator.mockImplementation(({ provider }: { provider?: string }) => ({
      translate: provider === 'deepl' ? deeplTranslate : googleTranslate,
    }));
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Provider source'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(googleTranslate).toHaveBeenCalledTimes(1));

    act(() => mocks.reader.setSettings({ ...mocks.settings, translationProvider: 'deepl' }));
    await waitFor(() =>
      expect(deeplTranslate).toHaveBeenCalledWith(['Provider source'], {
        source: 'en',
        target: 'zh-CN',
      }),
    );
    await waitFor(() =>
      expect(result.current.pages[0]?.translatedParagraphs).toEqual(['DeepL replacement']),
    );
    await act(async () => resolveGoogle(['Late Google result']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({
        sourceParagraphs: ['Provider source'],
        translatedParagraphs: ['DeepL replacement'],
      }),
    ]);
  });

  it('replaces a pending translation through the reactive target-language subscription', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, paragraphs: ['Target source'] }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate
      .mockReturnValueOnce(new Promise<string[]>((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(['Traduction de remplacement']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(mocks.translate).toHaveBeenCalledTimes(1));

    act(() => mocks.reader.setSettings({ ...mocks.settings, translateTargetLang: 'fr' }));
    await waitFor(() =>
      expect(mocks.translate).toHaveBeenLastCalledWith(['Target source'], {
        source: 'en',
        target: 'fr',
      }),
    );
    await waitFor(() =>
      expect(result.current.pages[0]?.translatedParagraphs).toEqual(['Traduction de remplacement']),
    );
    await act(async () => resolveFirst(['Late zh-CN result']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({
        sourceParagraphs: ['Target source'],
        translatedParagraphs: ['Traduction de remplacement'],
      }),
    ]);
  });

  it('shows the scanned-PDF toast after a rendered empty text layer', async () => {
    const view = makeView();
    mocks.getSources.mockReturnValue([]);
    renderHook(() => usePDFTranslation('book-1', view));

    act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        'toast',
        expect.objectContaining({ message: expect.stringContaining('No selectable text') }),
      ),
    );
  });
});
