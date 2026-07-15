import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const view = Object.assign(document.createElement('foliate-view'), {
    open: vi.fn(() => new Promise<void>(() => {})),
  });
  return {
    pdfTranslation: { pages: [] as { index: number }[], retryPage: vi.fn() },
    usePDFTranslation: vi.fn(),
    useTextTranslation: vi.fn(),
    view,
  };
});

vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }) }));
vi.mock('@/libs/document', () => ({
  convertBlobUrlToDataUrl: vi.fn(),
  getDirection: vi.fn(),
}));
vi.mock('@/types/view', () => ({ wrappedFoliateView: () => mocks.view }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null, envConfig: {} }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeCode: null, isDarkMode: false }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { discordRichPresenceEnabled: false } }),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({
    loadFont: vi.fn(),
    loadCustomFonts: vi.fn(),
    getLoadedFonts: () => [],
    getAvailableFonts: () => [],
  }),
}));
vi.mock('@/store/parallelViewStore', () => ({
  useParallelViewStore: () => ({ getParallels: () => [] }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({ getBookData: () => ({ book: { format: 'PDF' } }) }),
}));
vi.mock('@/store/readerStore', () => {
  const state = {
    getView: vi.fn(),
    setView: vi.fn(),
    setViewInited: vi.fn(),
    setProgress: vi.fn(),
    setPreviewMode: vi.fn(),
    getViewState: () => ({ loading: false, isPrimary: false }),
    getProgress: vi.fn(),
    getViewSettings: () => ({ translationEnabled: true }),
    setViewSettings: vi.fn(),
  };
  return { useReaderStore: (selector: (store: typeof state) => unknown) => selector(state) };
});
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({
  useTextTranslation: mocks.useTextTranslation,
}));
vi.mock('@/app/reader/hooks/usePDFTranslation', () => ({
  usePDFTranslation: (...args: unknown[]) => {
    mocks.usePDFTranslation(...args);
    return mocks.pdfTranslation;
  },
}));
vi.mock('@/app/reader/components/PDFTranslationPane', () => ({
  default: () => <aside data-testid='pdf-translation-pane' />,
}));
vi.mock('@/app/reader/hooks/useIframeEvents', () => ({
  useMouseEvent: () => ({}),
  useTouchEvent: () => ({}),
  useOpenMediaEvent: vi.fn(),
}));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  useCapturedTurn: vi.fn(),
  applyPageTurnAttributes: vi.fn(),
}));
vi.mock('@/app/reader/hooks/useBrightnessGesture', () => ({
  useBrightnessGesture: () => ({
    registerBrightnessListeners: vi.fn(),
    overlayVisible: false,
    overlayLevel: 0,
  }),
}));
vi.mock('@/app/reader/hooks/usePagination', () => ({
  usePagination: () => ({ handlePageFlip: vi.fn() }),
}));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
vi.mock('@/app/reader/hooks/useProgressSync', () => ({ useProgressSync: vi.fn() }));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({ useProgressAutoSave: vi.fn() }));
vi.mock('@/app/reader/hooks/useKOSync', () => ({
  useKOSync: () => ({
    syncState: 'idle',
    conflictDetails: null,
    resolveWithLocal: vi.fn(),
    resolveWithRemote: vi.fn(),
  }),
}));
vi.mock('@/app/reader/hooks/useFileSync', () => ({ useFileSync: vi.fn() }));
vi.mock('@/app/reader/hooks/useAutoSaveBookCover', () => ({ useBookCoverAutoSave: vi.fn() }));
vi.mock('@/app/reader/hooks/useMiddleClickAutoscroll', () => ({
  useMiddleClickAutoscroll: () => null,
}));
vi.mock('@/app/reader/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({
    active: false,
    paused: false,
    speed: 0,
    togglePause: vi.fn(),
    adjustSpeed: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: vi.fn() }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({ applyEinkMode: vi.fn() }) }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: vi.fn() }));
vi.mock('@/utils/style', () => ({
  applyFixedlayoutStyles: vi.fn(),
  applyImageStyle: vi.fn(),
  applyScrollbarStyle: vi.fn(),
  applyScrollModeClass: vi.fn(),
  applyThemeModeClass: vi.fn(),
  applyTranslationStyle: vi.fn(),
  getStyles: vi.fn(),
  getThemeCode: vi.fn(),
  keepTextAlignment: vi.fn(),
  transformStylesheet: vi.fn(),
}));
vi.mock('@/utils/scrollable', () => ({
  applyScrollableStyle: vi.fn(),
  applyTableTouchScroll: vi.fn(),
}));
vi.mock('@/styles/fonts', () => ({ mountAdditionalFonts: vi.fn(), mountCustomFont: vi.fn() }));
vi.mock('@/utils/warichu', () => ({ layoutWarichu: vi.fn(), relayoutWarichu: vi.fn() }));
vi.mock('@/app/reader/utils/wordlensSection', () => ({ refreshSectionGlosses: vi.fn() }));
vi.mock('@/components/Spinner', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/AutoscrollIndicator', () => ({ default: () => null }));
vi.mock('@/app/reader/components/AutoScrollControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/KOSyncResolver', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

import FoliateViewer from '@/app/reader/components/FoliateViewer';

afterEach(() => {
  cleanup();
  mocks.pdfTranslation.pages = [];
  mocks.usePDFTranslation.mockClear();
  mocks.useTextTranslation.mockClear();
  mocks.view.remove();
});

const renderViewer = () =>
  render(
    <FoliateViewer
      bookKey='book-1'
      bookDoc={{ metadata: {} } as never}
      config={{} as never}
      gridInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      contentInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
    />,
  );

describe('FoliateViewer PDF translation layout', () => {
  it('keeps the reader full size when the PDF translation pane is hidden', () => {
    const { getByRole, queryByTestId } = renderViewer();
    const reader = getByRole('main');

    expect(reader.className).toContain('absolute');
    expect(reader.className).toContain('h-full');
    expect(reader.className).toContain('w-full');
    expect(reader.parentElement?.className).toContain('foliate-viewer');
    expect(queryByTestId('pdf-translation-pane')).toBeNull();
    expect(mocks.useTextTranslation).toHaveBeenCalledWith('book-1', null);
    expect(mocks.usePDFTranslation).toHaveBeenCalledWith('book-1', null);
  });

  it('splits the PDF reader and external translation pane when pages are available', () => {
    mocks.pdfTranslation.pages = [{ index: 0 }];
    const { getByRole, getByTestId } = renderViewer();
    const reader = getByRole('main');

    expect(reader.className).toContain('flex-1');
    expect(reader.className).toContain('basis-1/2');
    expect(reader.parentElement?.className).toContain('flex');
    expect(reader.parentElement?.className).toContain('flex-col');
    expect(reader.parentElement?.className).toContain('md:flex-row');
    expect(getByTestId('pdf-translation-pane').parentElement?.className).toContain('basis-1/2');
  });
});
