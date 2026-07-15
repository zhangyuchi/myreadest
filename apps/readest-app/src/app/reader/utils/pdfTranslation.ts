import type { FoliateView } from '@/types/view';

export interface PDFPageSource {
  index: number;
  paragraphs: string[];
}

type PositionedText = { text: string; rect: DOMRect };

type TextLine = {
  spans: PositionedText[];
  top: number;
  bottom: number;
};

const PAGE_EDGE_RATIO = 0.08;

const intersects = (page: DOMRect, viewport: DOMRect) =>
  page.bottom > viewport.top &&
  page.top < viewport.bottom &&
  page.right > viewport.left &&
  page.left < viewport.right;

function getBodyParagraphs(textLayer: Element): string[] {
  const layerRect = textLayer.getBoundingClientRect();
  const height = layerRect.height;
  const spans = [...textLayer.querySelectorAll('span:not([role="img"])')]
    .map((span): PositionedText | null => {
      const text = span.textContent?.replace(/\s+/gu, ' ').trim();
      const rect = span.getBoundingClientRect();
      if (!text || rect.width === 0 || rect.height === 0) return null;
      const center = (rect.top + rect.bottom) / 2;
      const relativeCenter = height === 0 ? 0.5 : (center - layerRect.top) / height;
      return relativeCenter > PAGE_EDGE_RATIO && relativeCenter < 1 - PAGE_EDGE_RATIO
        ? { text, rect }
        : null;
    })
    .filter((span): span is PositionedText => span !== null)
    .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

  const lines: TextLine[] = [];
  for (const span of spans) {
    const line = lines.at(-1);
    const previousSpan = line?.spans.at(-1);
    const spanCenter = (span.rect.top + span.rect.bottom) / 2;
    if (line && previousSpan) {
      const previousCenter = (previousSpan.rect.top + previousSpan.rect.bottom) / 2;
      const lineThreshold = Math.max(2, Math.max(span.rect.height, previousSpan.rect.height) / 2);
      if (Math.abs(spanCenter - previousCenter) <= lineThreshold) {
        line.spans.push(span);
        line.top = Math.min(line.top, span.rect.top);
        line.bottom = Math.max(line.bottom, span.rect.bottom);
        continue;
      }
    }

    lines.push({ spans: [span], top: span.rect.top, bottom: span.rect.bottom });
  }

  const medianLineHeight = [...lines]
    .map((line) => line.bottom - line.top)
    .sort((left, right) => left - right)
    .at(Math.floor(lines.length / 2));
  const paragraphLines: string[][] = [];

  for (const [index, line] of lines.entries()) {
    const text = line.spans.reduce((joined, span, spanIndex) => {
      if (spanIndex === 0) return span.text;
      const previousSpan = line.spans[spanIndex - 1]!;
      const gap = span.rect.left - previousSpan.rect.right;
      const wordGap = Math.min(span.rect.height, previousSpan.rect.height) * 0.2;
      return `${joined}${gap > wordGap ? ' ' : ''}${span.text}`;
    }, '');
    const previousLine = lines[index - 1];
    const lineGap = previousLine ? line.top - previousLine.bottom : 0;
    if (!previousLine || lineGap > (medianLineHeight ?? 0) / 2) {
      paragraphLines.push([text]);
    } else {
      paragraphLines.at(-1)!.push(text);
    }
  }

  return paragraphLines.map((lines) => lines.join(' ')).filter(Boolean);
}

export function getVisiblePDFPageSources(view: FoliateView): PDFPageSource[] {
  const viewport = view.renderer.getBoundingClientRect();
  return view.renderer
    .getContents()
    .filter((content): content is { doc: Document; index: number; overlayer?: unknown } => {
      if (content.index == null) return false;
      const frame = content.doc.defaultView?.frameElement;
      return frame instanceof HTMLElement && intersects(frame.getBoundingClientRect(), viewport);
    })
    .map(({ doc, index }) => {
      const textLayer = doc.querySelector('.textLayer');
      return { index, paragraphs: textLayer ? getBodyParagraphs(textLayer) : [] };
    })
    .filter(({ paragraphs }) => paragraphs.length > 0);
}
