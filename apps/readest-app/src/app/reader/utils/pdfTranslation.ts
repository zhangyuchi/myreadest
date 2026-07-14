import type { FoliateView } from '@/types/view';

export interface PDFPageSource {
  index: number;
  text: string;
}

const intersects = (page: DOMRect, viewport: DOMRect) =>
  page.bottom > viewport.top &&
  page.top < viewport.bottom &&
  page.right > viewport.left &&
  page.left < viewport.right;

export function getVisiblePDFPageSources(view: FoliateView): PDFPageSource[] {
  const viewport = view.renderer.getBoundingClientRect();
  return view.renderer
    .getContents()
    .filter((content): content is { doc: Document; index: number; overlayer?: unknown } => {
      if (content.index == null) return false;
      const frame = content.doc.defaultView?.frameElement;
      return frame instanceof HTMLElement && intersects(frame.getBoundingClientRect(), viewport);
    })
    .map(({ doc, index }) => ({
      index,
      text: doc.querySelector('.textLayer')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    }))
    .filter(({ text }) => text.length > 0);
}
