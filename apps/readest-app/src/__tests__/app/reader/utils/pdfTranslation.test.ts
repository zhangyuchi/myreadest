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

const makePage = (
  index: number,
  text: string,
  top: number,
  bottom: number,
  left = 0,
  right = 600,
) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframe.getBoundingClientRect = () => rect(top, bottom, left, right);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = `<div class="textLayer"><span>${text}</span></div>`;
  return { doc, index };
};

describe('getVisiblePDFPageSources', () => {
  it('returns visible page text in renderer order and ignores offscreen pages', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const contents = [
      makePage(2, 'Second page', 0, 400),
      makePage(3, 'Third page', 400, 800),
      makePage(4, 'Offscreen page', 900, 1300),
      makePage(5, 'Horizontally offscreen page', 0, 800, 700, 1300),
    ];
    const view = {
      renderer: Object.assign(renderer, { getContents: () => contents }),
    } as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      { index: 2, text: 'Second page' },
      { index: 3, text: 'Third page' },
    ]);
  });

  it('does not append translation nodes to the PDF document', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(0, 'Source text', 0, 800);
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as FoliateView;

    getVisiblePDFPageSources(view);

    expect(page.doc.querySelector('.translation-target')).toBeNull();
  });
});
