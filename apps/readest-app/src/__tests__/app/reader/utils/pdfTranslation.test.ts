import { describe, expect, it, vi } from 'vitest';
import { getVisiblePDFPageSources } from '@/app/reader/utils/pdfTranslation';
import type { FoliateView } from '@/types/view';

const rect = (top: number, bottom: number, left = 0, right = 600): DOMRect =>
  ({
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: vi.fn(),
  }) as DOMRect;

type PositionedSpan = {
  text: string;
  top: number;
  bottom: number;
  left?: number;
  right?: number;
};

const makePage = (
  index: number,
  spans: PositionedSpan[],
  top: number,
  bottom: number,
  left = 0,
  right = 600,
) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframe.getBoundingClientRect = () => rect(top, bottom, left, right);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<div class="textLayer"></div>';
  const textLayer = doc.querySelector('.textLayer')!;
  textLayer.getBoundingClientRect = () => rect(0, 1000);
  for (const span of spans) {
    const element = doc.createElement('span');
    element.textContent = span.text;
    element.getBoundingClientRect = () =>
      rect(span.top, span.bottom, span.left ?? 0, span.right ?? 600);
    textLayer.appendChild(element);
  }
  return { doc, index };
};

describe('getVisiblePDFPageSources', () => {
  it('extracts visible body paragraphs in renderer order and ignores offscreen pages', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const contents = [
      makePage(
        0,
        [
          { text: 'Document header', top: 35, bottom: 45 },
          { text: 'First body line.', top: 190, bottom: 200 },
          { text: 'It continues.', top: 204, bottom: 214 },
          { text: 'Second paragraph.', top: 270, bottom: 280 },
          { text: 'Page footer', top: 965, bottom: 975 },
        ],
        0,
        400,
      ),
      makePage(1, [{ text: 'Offscreen page', top: 190, bottom: 200 }], 900, 1300),
      makePage(
        2,
        [{ text: 'Horizontally offscreen page', top: 190, bottom: 200 }],
        0,
        800,
        700,
        1300,
      ),
    ];
    const view = {
      renderer: Object.assign(renderer, { getContents: () => contents }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        paragraphs: ['First body line. It continues.', 'Second paragraph.'],
      },
    ]);
  });

  it('does not append translation nodes to the PDF document', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(0, [{ text: 'Source text', top: 190, bottom: 200 }], 0, 800);
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    getVisiblePDFPageSources(view);

    expect(page.doc.querySelector('.translation-target')).toBeNull();
  });
});
