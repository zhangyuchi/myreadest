import type { FoliateView } from '@/types/view';

export interface PDFPageSource {
  index: number;
  blocks: PDFSourceBlock[];
}

export interface PDFSourceBlock {
  kind: 'heading' | 'unordered-list' | 'ordered-list' | 'blockquote' | 'paragraph';
  text: string;
  headingLevel?: 1 | 2 | 3;
}

type PositionedText = { text: string; rect: DOMRect };

type TextLine = {
  spans: PositionedText[];
  top: number;
  bottom: number;
};

type TextRegion = {
  left: number;
  lines: TextLine[];
};

const PAGE_EDGE_RATIO = 0.08;

const intersects = (page: DOMRect, viewport: DOMRect) =>
  page.bottom > viewport.top &&
  page.top < viewport.bottom &&
  page.right > viewport.left &&
  page.left < viewport.right;

const median = (values: number[]) =>
  [...values].sort((left, right) => left - right).at(Math.floor(values.length / 2));

const lowerMedian = (values: number[]) =>
  [...values].sort((left, right) => left - right).at(Math.floor((values.length - 1) / 2));

const textForLine = (line: TextLine) =>
  line.spans.reduce((joined, span, spanIndex) => {
    if (spanIndex === 0) return span.text;
    const previousSpan = line.spans[spanIndex - 1]!;
    const gap = span.rect.left - previousSpan.rect.right;
    const wordGap = Math.min(span.rect.height, previousSpan.rect.height) * 0.2;
    return `${joined}${gap > wordGap ? ' ' : ''}${span.text}`;
  }, '');

const joinParagraphLines = (previous: string, next: string) =>
  previous.endsWith('-') && /^\p{Ll}/u.test(next)
    ? `${previous.slice(0, -1)}${next}`
    : `${previous} ${next}`;

const lineForSpans = (spans: PositionedText[]): TextLine => ({
  spans,
  top: Math.min(...spans.map((span) => span.rect.top)),
  bottom: Math.max(...spans.map((span) => span.rect.bottom)),
});

function getBodyBlocks(textLayer: Element): PDFSourceBlock[] {
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

    lines.push(lineForSpans([span]));
  }

  const medianLineHeight = median(lines.map((line) => line.bottom - line.top)) ?? 0;
  const medianSpanHeight = median(spans.map((span) => span.rect.height)) ?? 0;
  const fragmentGap = Math.max(medianSpanHeight * 4, layerRect.width * 0.12);
  const lineFragments = lines.map((line) => {
    const fragments: TextLine[] = [];
    let fragmentSpans: PositionedText[] = [];
    for (const span of line.spans) {
      const previousSpan = fragmentSpans.at(-1);
      if (previousSpan && span.rect.left - previousSpan.rect.right > fragmentGap) {
        fragments.push(lineForSpans(fragmentSpans));
        fragmentSpans = [];
      }
      fragmentSpans.push(span);
    }
    fragments.push(lineForSpans(fragmentSpans));
    return fragments;
  });
  const splitStartTolerance = Math.max(medianSpanHeight * 4, layerRect.width * 0.02);
  const splitStarts = lineFragments.flatMap((fragments, lineIndex) =>
    fragments.slice(1).map((fragment) => ({ lineIndex, left: fragment.spans[0]!.rect.left })),
  );
  const recurringSplitStarts: number[] = [];
  for (const split of splitStarts) {
    if (recurringSplitStarts.some((start) => Math.abs(start - split.left) <= splitStartTolerance)) {
      continue;
    }
    const matchingLines = new Set(
      splitStarts
        .filter((candidate) => Math.abs(candidate.left - split.left) <= splitStartTolerance)
        .map((candidate) => candidate.lineIndex),
    );
    if (matchingLines.size >= 2) recurringSplitStarts.push(split.left);
  }
  const hasRecurringRegions = recurringSplitStarts.length > 0;
  const fragmentsByRegion = hasRecurringRegions
    ? lineFragments.map((fragments) => {
        const groupedFragments: TextLine[] = [fragments[0]!];
        for (const fragment of fragments.slice(1)) {
          if (
            recurringSplitStarts.some(
              (start) => Math.abs(start - fragment.spans[0]!.rect.left) <= splitStartTolerance,
            )
          ) {
            groupedFragments.push(fragment);
            continue;
          }
          const previousFragment = groupedFragments.pop()!;
          groupedFragments.push(lineForSpans([...previousFragment.spans, ...fragment.spans]));
        }
        return groupedFragments;
      })
    : [lines];
  const regions: TextRegion[] = hasRecurringRegions
    ? [
        {
          left: Math.min(
            ...fragmentsByRegion.flatMap((fragments) => fragments[0]!.spans[0]!.rect.left),
          ),
          lines: [],
        },
        ...recurringSplitStarts.map((left) => ({ left, lines: [] })),
      ]
    : [{ left: 0, lines }];
  if (hasRecurringRegions) {
    for (const fragments of fragmentsByRegion) {
      for (const fragment of fragments) {
        const region = regions
          .filter(
            (candidate) => candidate.left <= fragment.spans[0]!.rect.left + splitStartTolerance,
          )
          .at(-1)!;
        region.lines.push(fragment);
      }
    }
  }
  const structuralBlockForLine = (line: TextLine): PDFSourceBlock | null => {
    const text = textForLine(line);
    const lineHeight = line.bottom - line.top;
    const headingLevel =
      lineHeight >= medianLineHeight * 2
        ? 1
        : lineHeight >= medianLineHeight * 1.6
          ? 2
          : lineHeight >= medianLineHeight * 1.3
            ? 3
            : null;
    const unorderedList = text.match(/^[•◦▪*-]\s+/u);
    const orderedList = text.match(/^\d+[.)]\s+/u);
    return unorderedList
      ? { kind: 'unordered-list', text: text.slice(unorderedList[0].length) }
      : orderedList
        ? { kind: 'ordered-list', text: text.slice(orderedList[0].length) }
        : headingLevel
          ? { kind: 'heading', headingLevel, text }
          : null;
  };
  const blocks: PDFSourceBlock[] = [];
  for (const region of regions.sort((left, right) => left.left - right.left)) {
    region.lines.sort((left, right) => left.top - right.top);
    const bodyLeft = Math.min(
      ...region.lines
        .filter((line) => structuralBlockForLine(line) === null)
        .map((line) => line.spans[0]!.rect.left),
    );
    const isIndented = (line: TextLine) => line.spans[0]!.rect.left - bodyLeft > medianLineHeight;
    let proseLines: TextLine[] = [];
    const flushProse = () => {
      if (proseLines.length === 0) return;
      const text = proseLines
        .map(textForLine)
        .reduce((joined, lineText) => joinParagraphLines(joined, lineText));
      blocks.push({
        kind: proseLines.length > 1 && proseLines.every(isIndented) ? 'blockquote' : 'paragraph',
        text,
      });
      proseLines = [];
    };

    for (const line of region.lines) {
      const structuralBlock = structuralBlockForLine(line);
      if (structuralBlock) {
        flushProse();
        blocks.push(structuralBlock);
        continue;
      }

      const previousLine = proseLines.at(-1);
      const lineGap = previousLine ? line.top - previousLine.bottom : 0;
      const quoteCandidate = proseLines.length > 1 && proseLines.every(isIndented);
      const quoteLeft = quoteCandidate
        ? (lowerMedian(proseLines.map((candidate) => candidate.spans[0]!.rect.left)) ?? null)
        : null;
      const outdentsQuote =
        quoteLeft !== null && line.spans[0]!.rect.left < quoteLeft - medianLineHeight;
      if (
        previousLine &&
        (lineGap > medianLineHeight ||
          (isIndented(line) && !isIndented(previousLine)) ||
          outdentsQuote)
      ) {
        flushProse();
      }
      proseLines.push(line);
    }

    flushProse();
  }

  return blocks;
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
      return { index, blocks: textLayer ? getBodyBlocks(textLayer) : [] };
    })
    .filter(({ blocks }) => blocks.length > 0);
}
