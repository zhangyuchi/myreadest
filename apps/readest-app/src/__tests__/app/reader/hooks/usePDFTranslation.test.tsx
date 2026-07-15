import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';
import type { PDFSourceBlock } from '@/app/reader/utils/pdfTranslation';

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

const sourceBlocks = (...texts: string[]): PDFSourceBlock[] =>
  texts.map((text) => ({ kind: 'paragraph', text }));

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
  it('translates block plain text and publishes deterministic Markdown with AUTO fallback', async () => {
    mocks.getSources.mockReturnValue([
      {
        index: 0,
        blocks: [
          { kind: 'heading', headingLevel: 1, text: 'Source heading' },
          { kind: 'paragraph', text: 'Source body' },
          { kind: 'unordered-list', text: 'Source bullet' },
          { kind: 'ordered-list', text: 'Source ordered item' },
          { kind: 'blockquote', text: 'Source quote' },
        ],
      },
    ]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'AUTO',
      provenance: 'fallback',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['翻译标题', '正文译文', '列表译文', '编号译文', '引文译文']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() =>
      expect(result.current.pages[0]).toEqual(
        expect.objectContaining({
          status: 'translated',
          translatedMarkdown: '# 翻译标题\n\n正文译文\n\n- 列表译文\n\n1. 编号译文\n\n> 引文译文',
        }),
      ),
    );
    expect(mocks.translate).toHaveBeenCalledWith(
      ['Source heading', 'Source body', 'Source bullet', 'Source ordered item', 'Source quote'],
      {
        source: 'AUTO',
        target: 'zh-CN',
      },
    );
    expect(result.current.pages[0]?.sourceBlocks).toEqual([
      { kind: 'heading', headingLevel: 1, text: 'Source heading' },
      { kind: 'paragraph', text: 'Source body' },
      { kind: 'unordered-list', text: 'Source bullet' },
      { kind: 'ordered-list', text: 'Source ordered item' },
      { kind: 'blockquote', text: 'Source quote' },
    ]);
  });

  it('publishes an error instead of source text when translation rejects', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Hello PDF') }]);
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
    expect(result.current.pages[0]?.translatedMarkdown).toBeUndefined();
  });

  it('publishes an error when translation response does not align with source blocks', async () => {
    mocks.getSources.mockReturnValue([
      { index: 0, blocks: sourceBlocks('First body paragraph.', 'Second body paragraph.') },
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
    expect(result.current.pages[0]?.translatedMarkdown).toBeUndefined();
  });

  it('publishes an error when a translated paragraph is blank after trimming', async () => {
    mocks.getSources.mockReturnValue([
      { index: 0, blocks: sourceBlocks('First body paragraph.', 'Second body paragraph.') },
    ]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'detected',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['第一段。', '   ']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));
    expect(result.current.pages[0]).toEqual(
      expect.objectContaining({
        error: 'Translation did not return one result for each paragraph.',
      }),
    );
    expect(result.current.pages[0]?.translatedMarkdown).toBeUndefined();
  });

  it('keeps provider HTML-like text as escaped Markdown source text', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Source text') }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'detected',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['<img src=x onerror=alert(1)>']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translated'));
    expect(result.current.pages[0]?.translatedMarkdown).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('ignores a late result after the visible page changes', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, blocks: sourceBlocks('First page') }])
      .mockReturnValue([{ index: 1, blocks: sourceBlocks('Second page') }]);
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
      expect.objectContaining({ index: 1, translatedMarkdown: '第二页' }),
    ]);
  });

  it('skips after a trusted same-language detection', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Hello PDF') }]);
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
      { index: 4, blocks: sourceBlocks('Left') },
      { index: 5, blocks: sourceBlocks('Right') },
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
    mocks.getSources
      .mockReturnValueOnce([])
      .mockReturnValue([{ index: 0, blocks: sourceBlocks('Ready') }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['就绪']);
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));

    await waitFor(() => expect(result.current.pages[0]?.translatedMarkdown).toBe('就绪'));
  });

  it('ignores a pending translation after a newer text-layer refresh', async () => {
    let resolveFirst!: (texts: string[]) => void;
    const view = makeView();
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, blocks: sourceBlocks('First layer') }])
      .mockReturnValue([{ index: 1, blocks: sourceBlocks('Second layer') }]);
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
    await waitFor(() => expect(result.current.pages[0]?.translatedMarkdown).toBe('第二层'));
    await act(async () => resolveFirst(['第一层']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({ index: 1, translatedMarkdown: '第二层' }),
    ]);
  });

  it('ignores pending work after the view is replaced', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, blocks: sourceBlocks('First view') }])
      .mockReturnValue([{ index: 1, blocks: sourceBlocks('Replacement view') }]);
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
    await waitFor(() => expect(result.current.pages[0]?.translatedMarkdown).toBe('替换页'));
    await act(async () => resolveFirst(['旧视图']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({ index: 1, translatedMarkdown: '替换页' }),
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
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Retry me') }]);
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

    await waitFor(() => expect(result.current.pages[0]?.translatedMarkdown).toBe('重试成功'));
  });

  it('ignores a pending retry after a newer refresh', async () => {
    let resolveRetry!: (texts: string[]) => void;
    const view = makeView();
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Retry me') }]);
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
    await waitFor(() => expect(result.current.pages[0]?.translatedMarkdown).toBe('刷新结果'));
    await act(async () => resolveRetry(['过期重试']));

    expect(result.current.pages[0]?.translatedMarkdown).toBe('刷新结果');
  });

  it('does not retry translated or translating pages', async () => {
    let resolveTranslation!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Already translating') }]);
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
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Pending') }]);
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
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Pending unmount') }]);
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
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Provider source') }]);
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
      expect(result.current.pages[0]?.translatedMarkdown).toBe('DeepL replacement'),
    );
    await act(async () => resolveGoogle(['Late Google result']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({
        sourceBlocks: sourceBlocks('Provider source'),
        translatedMarkdown: 'DeepL replacement',
      }),
    ]);
  });

  it('replaces a pending translation through the reactive target-language subscription', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, blocks: sourceBlocks('Target source') }]);
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
      expect(result.current.pages[0]?.translatedMarkdown).toBe('Traduction de remplacement'),
    );
    await act(async () => resolveFirst(['Late zh-CN result']));

    expect(result.current.pages).toEqual([
      expect.objectContaining({
        sourceBlocks: sourceBlocks('Target source'),
        translatedMarkdown: 'Traduction de remplacement',
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
