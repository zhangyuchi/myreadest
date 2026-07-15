import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';

const mocks = vi.hoisted(() => ({
  translate: vi.fn(),
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
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({ translate: mocks.translate }),
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
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({
      getViewSettings: () => mocks.settings,
      setIsLoading: vi.fn(),
    }),
}));
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
  mocks.progress.index = 0;
  mocks.settings.translationEnabled = true;
  mocks.settings.translationProvider = 'google';
  mocks.settings.translateTargetLang = 'zh-CN';
  mocks.bookData.book.primaryLanguage = '';
});

describe('usePDFTranslation', () => {
  it('translates with AUTO when detection falls back', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, text: 'Hello PDF' }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'AUTO',
      provenance: 'fallback',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['你好 PDF']);

    const view = makeView();
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translated'));
    expect(mocks.translate).toHaveBeenCalledWith(['Hello PDF'], {
      source: 'AUTO',
      target: 'zh-CN',
    });
    expect(result.current.pages[0]?.translatedText).toBe('你好 PDF');
  });

  it('publishes an error instead of source text when translation rejects', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, text: 'Hello PDF' }]);
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
    expect(result.current.pages[0]?.translatedText).toBeUndefined();
  });

  it('ignores a late result after the visible page changes', async () => {
    let resolveFirst!: (texts: string[]) => void;
    mocks.getSources
      .mockReturnValueOnce([{ index: 0, text: 'First page' }])
      .mockReturnValue([{ index: 1, text: 'Second page' }]);
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
      expect.objectContaining({ index: 1, translatedText: '第二页' }),
    ]);
  });

  it('skips after a trusted same-language detection', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, text: 'Hello PDF' }]);
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
      { index: 4, text: 'Left' },
      { index: 5, text: 'Right' },
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
    mocks.getSources.mockReturnValueOnce([]).mockReturnValue([{ index: 0, text: 'Ready' }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockResolvedValue(['就绪']);
    const { result } = renderHook(() => usePDFTranslation('book-1', view));

    act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));

    await waitFor(() => expect(result.current.pages[0]?.translatedText).toBe('就绪'));
  });

  it('retries only the failed page', async () => {
    mocks.getSources.mockReturnValue([{ index: 0, text: 'Retry me' }]);
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

    await waitFor(() => expect(result.current.pages[0]?.translatedText).toBe('重试成功'));
  });

  it('clears state and ignores pending work when translation is disabled', async () => {
    let resolveTranslation!: (texts: string[]) => void;
    mocks.getSources.mockReturnValue([{ index: 0, text: 'Pending' }]);
    mocks.resolveLanguage.mockResolvedValue({
      language: 'en',
      provenance: 'metadata',
      skipTranslation: false,
    });
    mocks.translate.mockReturnValue(
      new Promise<string[]>((resolve) => (resolveTranslation = resolve)),
    );
    const view = makeView();
    const { result, rerender } = renderHook(() => usePDFTranslation('book-1', view));
    await waitFor(() => expect(result.current.pages[0]?.status).toBe('translating'));

    mocks.settings.translationEnabled = false;
    rerender();
    await act(async () => resolveTranslation(['迟到结果']));

    expect(result.current.pages).toEqual([]);
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
