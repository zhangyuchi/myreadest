import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pdfjs/pdf.min.mjs', () => {
  class PDFDataRangeTransport {
    requestDataRange!: (begin: number, end: number) => void;
    onDataRange = vi.fn();
    constructor(
      public length: number,
      public initialData: unknown,
    ) {}
  }
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    streamTextContent: () => ({}),
    getTextContent: async () => ({ items: [] }),
    getAnnotations: async () => [],
    cleanup: () => {},
  };
  const pdf = {
    numPages: 1,
    getPage: vi.fn(async () => page),
    getMetadata: vi.fn(async () => ({ metadata: undefined, info: {} })),
    getOutline: vi.fn(async () => null),
    getDestination: vi.fn(),
    getPageIndex: vi.fn(),
    destroy: vi.fn(),
  };
  class TextLayer {
    container: Element;
    constructor({ container }: { container: Element }) {
      this.container = container;
    }
    async render() {
      await Promise.resolve();
      const marker = document.createElement('span');
      marker.className = 'text-layer-render-complete';
      this.container.append(marker);
    }
  }
  class AnnotationLayer {
    render = async () => {};
  }
  (globalThis as unknown as { pdfjsLib: unknown }).pdfjsLib = {
    GlobalWorkerOptions: {},
    PDFDataRangeTransport,
    getDocument: vi.fn(() => ({ promise: Promise.resolve(pdf) })),
    TextLayer,
    AnnotationLayer,
  };
  return {};
});

beforeEach(() => {
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ text: async () => '' })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('PDF text-layer rendered event', () => {
  it('dispatches the completed iframe text-layer event with its source document', async () => {
    const { makePDF } = await import('foliate-js/pdf.js');
    const file = { size: 1024, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) };
    const book = (await makePDF(file as unknown as File)) as unknown as {
      sections: { load: () => Promise<{ onZoom: (arg: unknown) => Promise<void> }> }[];
    };
    const { onZoom } = await book.sections[0]!.load();
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML =
      '<div id="canvas"></div><div class="textLayer"></div><div class="annotationLayer"></div>';

    const events: CustomEvent<{ doc: Document }>[] = [];
    iframe.addEventListener('pdf-text-layer-rendered', (event) => {
      expect(doc.querySelector('.text-layer-render-complete')).not.toBeNull();
      expect(doc.querySelector('.endOfContent')).not.toBeNull();
      events.push(event as CustomEvent<{ doc: Document }>);
    });

    await onZoom({ doc, scale: 1, pageColors: null });

    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe(iframe);
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
    expect(events[0]!.detail).toEqual({ doc });
  });
});
