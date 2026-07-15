import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PDFTranslationPane from '@/app/reader/components/PDFTranslationPane';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';
import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';
import type { FoliateView } from '@/types/view';

const mocks = vi.hoisted(() => ({
  translate: vi.fn().mockResolvedValue(['PDF 译文']),
  progress: { index: 0 },
  settings: {
    translationEnabled: true,
    translationProvider: 'google',
    translateTargetLang: 'zh-CN',
  },
  bookData: { book: { format: 'PDF', primaryLanguage: 'en' } },
  translateUI: (text: string) => text,
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({ translate: mocks.translate }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => mocks.translateUI,
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.progress,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({
      viewStates: { 'book-1': { viewSettings: mocks.settings } },
      getViewSettings: () => mocks.settings,
      setIsLoading: vi.fn(),
    }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector?: (state: unknown) => unknown) => {
    const state = { getBookData: () => mocks.bookData };
    return selector ? selector(state) : state;
  },
}));

class ImmediateIntersectionObserver {
  constructor(
    private readonly callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {}

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

const fixtureRenderers: HTMLElement[] = [];

afterEach(() => {
  fixtureRenderers.splice(0).forEach((renderer) => renderer.remove());
});

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    left: 0,
    right: 600,
    width: 600,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: vi.fn(),
  }) as DOMRect;

const makeView = () => {
  const renderer = document.createElement('div');
  renderer.getBoundingClientRect = () => rect(0, 800);
  const iframe = document.createElement('iframe');
  iframe.getBoundingClientRect = () => rect(0, 800);
  renderer.appendChild(iframe);
  document.body.appendChild(renderer);
  fixtureRenderers.push(renderer);
  const pageDocument = iframe.contentDocument!;
  pageDocument.body.innerHTML = '<div class="textLayer"><span>Rendered PDF source</span></div>';
  Object.assign(renderer, {
    getContents: () => [{ doc: pageDocument, index: 0 }],
  });
  return {
    pageDocument,
    view: Object.assign(document.createElement('div'), { renderer }) as unknown as FoliateView,
  };
};

const Harness = ({ view }: { view: FoliateView }) => {
  const { pages, retryPage } = usePDFTranslation('book-1', view);
  return <PDFTranslationPane pages={pages} onRetry={retryPage} />;
};

const LegacyPDFHarness = ({ renderer }: { renderer: HTMLElement }) => {
  useTextTranslation('book-1', renderer);
  return null;
};

describe('PDF translation flow', () => {
  it('renders extracted PDF text in the external pane without mutating the iframe', async () => {
    const { pageDocument, view } = makeView();
    render(<Harness view={view} />);

    await waitFor(() => expect(screen.getByText('PDF 译文')).toBeTruthy());
    expect(mocks.translate).toHaveBeenCalledWith(['Rendered PDF source'], {
      source: 'en',
      target: 'zh-CN',
    });
    expect(pageDocument.querySelector('.translation-target')).toBeNull();
  });

  it('does not inject a translation target into a PDF text layer', async () => {
    const { pageDocument, view } = makeView();
    render(<LegacyPDFHarness renderer={view.renderer} />);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pageDocument.querySelector('.translation-target')).toBeNull();
  });
});
