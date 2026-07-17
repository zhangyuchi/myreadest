import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';
import { useTextTranslation } from '@/app/reader/hooks/useTextTranslation';
import type { FoliateView } from '@/types/view';

const mocks = vi.hoisted(() => ({
  translate: vi
    .fn()
    .mockResolvedValue(['翻译标题', '正文译文', '列表译文', '编号译文', '引文译文']),
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
  pageDocument.body.innerHTML = '<div class="textLayer"></div>';
  const textLayer = pageDocument.querySelector('.textLayer')!;
  textLayer.getBoundingClientRect = () => rect(0, 1000);
  const positionedSpans: Array<[string, number, number, number?]> = [
    ['Document header', 35, 45],
    ['Source heading', 150, 190],
    ['Source body', 220, 230],
    ['• Source bullet', 250, 260],
    ['2) Source ordered item', 280, 290],
    ['Source quote', 310, 320, 120],
    ['continuation', 330, 340, 120],
    ['Page footer', 965, 975],
  ];
  for (const [text, top, bottom, left = 0] of positionedSpans) {
    const span = pageDocument.createElement('span');
    span.textContent = text;
    span.getBoundingClientRect = () =>
      ({ ...rect(top, bottom), left, right: left + 100 }) as DOMRect;
    textLayer.appendChild(span);
  }
  Object.assign(renderer, {
    getContents: () => [{ doc: pageDocument, index: 0 }],
  });
  return {
    pageDocument,
    view: Object.assign(document.createElement('div'), { renderer }) as unknown as FoliateView,
  };
};

const Harness = ({ view }: { view: FoliateView }) => {
  const { pages } = usePDFTranslation('book-1', view);
  return (
    <>
      <output data-testid='published-markdown'>
        {pages[0]?.translatedBlocks?.map((block) => block.markdown).join('\n')}
      </output>
    </>
  );
};

const LegacyPDFHarness = ({ renderer }: { renderer: HTMLElement }) => {
  useTextTranslation('book-1', renderer);
  return null;
};

describe('PDF translation flow', () => {
  it('publishes translated Markdown from extracted PDF source blocks without mutating the iframe', async () => {
    const { pageDocument, view } = makeView();
    render(<Harness view={view} />);

    await waitFor(() =>
      expect(screen.getByTestId('published-markdown').textContent).toBe(
        '# 翻译标题\n正文译文\n- 列表译文\n1. 编号译文\n> 引文译文',
      ),
    );
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    expect(mocks.translate).toHaveBeenNthCalledWith(
      1,
      [
        'Source heading',
        'Source body',
        'Source bullet',
        'Source ordered item',
        'Source quote continuation',
      ],
      {
        source: 'en',
        target: 'zh-CN',
      },
    );
    expect(pageDocument.querySelector('.translation-target')).toBeNull();
  });

  it('does not inject a translation target into a PDF text layer', async () => {
    const { pageDocument, view } = makeView();
    render(<LegacyPDFHarness renderer={view.renderer} />);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pageDocument.querySelector('.translation-target')).toBeNull();
  });
});
