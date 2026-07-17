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
  it('extracts typed source blocks from visible PDF body text', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const contents = [
      makePage(
        0,
        [
          { text: 'Document header', top: 35, bottom: 45 },
          { text: 'Title', top: 150, bottom: 190 },
          { text: 'Body paragraph.', top: 220, bottom: 230 },
          { text: '• Bullet item', top: 250, bottom: 260 },
          { text: '2) Numbered item', top: 280, bottom: 290 },
          { text: 'Quoted text', top: 310, bottom: 320, left: 120, right: 220 },
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
        blocks: [
          { kind: 'heading', headingLevel: 1, text: 'Title' },
          { kind: 'paragraph', text: 'Body paragraph.' },
          { kind: 'unordered-list', text: 'Bullet item' },
          { kind: 'ordered-list', text: 'Numbered item' },
          { kind: 'paragraph', text: 'Quoted text' },
        ],
      },
    ]);
  });

  it('omits a visible page containing only edge-band text', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'Document header', top: 35, bottom: 45 },
        { text: 'Page footer', top: 965, bottom: 975 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([]);
  });

  it('joins same-baseline spans according to their geometry', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'Hello', top: 190, bottom: 200, left: 0, right: 40 },
        { text: 'world', top: 190, bottom: 200, left: 43, right: 83 },
        { text: 'hyphen', top: 230, bottom: 240, left: 0, right: 50 },
        { text: 'ated', top: 230, bottom: 240, left: 50, right: 80 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          { kind: 'paragraph', text: 'Hello world' },
          { kind: 'paragraph', text: 'hyphenated' },
        ],
      },
    ]);
  });

  it('reconstructs indented source paragraphs from visual lines', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'The first paragraph wraps across', top: 150, bottom: 160 },
        { text: 'three visual lines before it', top: 162, bottom: 172 },
        { text: 'ends here.', top: 174, bottom: 184 },
        { text: 'The second paragraph begins', top: 186, bottom: 196, left: 24 },
        { text: 'at the body margin and ends here.', top: 198, bottom: 208 },
        { text: 'The third paragraph begins', top: 210, bottom: 220, left: 24 },
        { text: 'with two body-margin continuations', top: 222, bottom: 232 },
        { text: 'before it ends here.', top: 234, bottom: 244 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          {
            kind: 'paragraph',
            text: 'The first paragraph wraps across three visual lines before it ends here.',
          },
          {
            kind: 'paragraph',
            text: 'The second paragraph begins at the body margin and ends here.',
          },
          {
            kind: 'paragraph',
            text: 'The third paragraph begins with two body-margin continuations before it ends here.',
          },
        ],
      },
    ]);
  });

  it('reconstructs consistently indented visual lines as one blockquote', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'A body paragraph wraps', top: 150, bottom: 160 },
        { text: 'across three visual lines', top: 162, bottom: 172 },
        { text: 'before the quotation.', top: 174, bottom: 184 },
        { text: 'The first quoted visual line', top: 210, bottom: 220, left: 90 },
        { text: 'continues the same quotation.', top: 222, bottom: 232, left: 90 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          {
            kind: 'paragraph',
            text: 'A body paragraph wraps across three visual lines before the quotation.',
          },
          {
            kind: 'blockquote',
            text: 'The first quoted visual line continues the same quotation.',
          },
        ],
      },
    ]);
  });

  it('keeps a body-left line ahead of a quote-majority region', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'Body text establishes the prose margin.', top: 150, bottom: 160 },
        { text: 'The first quoted visual line.', top: 162, bottom: 172, left: 90 },
        { text: 'The second quoted visual line.', top: 174, bottom: 184, left: 90 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          { kind: 'paragraph', text: 'Body text establishes the prose margin.' },
          {
            kind: 'blockquote',
            text: 'The first quoted visual line. The second quoted visual line.',
          },
        ],
      },
    ]);
  });

  it('reads recurring wide-gap regions column by column', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'Left column first line.', top: 150, bottom: 160, left: 0, right: 120 },
        { text: 'Right column first line.', top: 150, bottom: 160, left: 360, right: 500 },
        { text: 'Left column second line.', top: 162, bottom: 172, left: 0, right: 130 },
        { text: 'Right column second line.', top: 162, bottom: 172, left: 360, right: 510 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          { kind: 'paragraph', text: 'Left column first line. Left column second line.' },
          { kind: 'paragraph', text: 'Right column first line. Right column second line.' },
        ],
      },
    ]);
  });

  it('keeps a one-off wide gap in one ordinary line', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'An ordinary line', top: 150, bottom: 160, left: 0, right: 90 },
        { text: 'with a distant span.', top: 150, bottom: 160, left: 360, right: 470 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [{ kind: 'paragraph', text: 'An ordinary line with a distant span.' }],
      },
    ]);
  });

  it('separates a consistently indented quote from following body text', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'The body paragraph has', top: 150, bottom: 160 },
        { text: 'three visual lines before', top: 162, bottom: 172 },
        { text: 'the quotation.', top: 174, bottom: 184 },
        { text: 'The first quoted visual line', top: 186, bottom: 196, left: 90 },
        { text: 'continues the quotation.', top: 198, bottom: 208, left: 90 },
        { text: 'The body text resumes here.', top: 210, bottom: 220 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          {
            kind: 'paragraph',
            text: 'The body paragraph has three visual lines before the quotation.',
          },
          {
            kind: 'blockquote',
            text: 'The first quoted visual line continues the quotation.',
          },
          { kind: 'paragraph', text: 'The body text resumes here.' },
        ],
      },
    ]);
  });

  it('separates a quote from a following first-line-indented paragraph', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'The body paragraph has', top: 150, bottom: 160 },
        { text: 'three visual lines before', top: 162, bottom: 172 },
        { text: 'the quotation.', top: 174, bottom: 184 },
        { text: 'The first quoted visual line', top: 186, bottom: 196, left: 90 },
        { text: 'continues the quotation.', top: 198, bottom: 208, left: 90 },
        { text: 'The next paragraph starts here', top: 210, bottom: 220, left: 24 },
        { text: 'and continues at the body margin.', top: 222, bottom: 232 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          {
            kind: 'paragraph',
            text: 'The body paragraph has three visual lines before the quotation.',
          },
          {
            kind: 'blockquote',
            text: 'The first quoted visual line continues the quotation.',
          },
          {
            kind: 'paragraph',
            text: 'The next paragraph starts here and continues at the body margin.',
          },
        ],
      },
    ]);
  });

  it('uses the body margin when first-line and body-left lines are balanced', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'The first paragraph begins', top: 150, bottom: 160, left: 24 },
        { text: 'and ends on its second line.', top: 162, bottom: 172 },
        { text: 'The second paragraph begins', top: 174, bottom: 184, left: 24 },
        { text: 'and ends on its second line.', top: 186, bottom: 196 },
        { text: 'The third paragraph begins', top: 198, bottom: 208, left: 24 },
        { text: 'and ends on its second line.', top: 210, bottom: 220 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          { kind: 'paragraph', text: 'The first paragraph begins and ends on its second line.' },
          { kind: 'paragraph', text: 'The second paragraph begins and ends on its second line.' },
          { kind: 'paragraph', text: 'The third paragraph begins and ends on its second line.' },
        ],
      },
    ]);
  });

  it('ignores structural-line positions when finding the body margin', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'Heading', top: 150, bottom: 170 },
        { text: '• List item', top: 180, bottom: 190 },
        { text: 'Shifted body text starts here', top: 200, bottom: 210, left: 24 },
        { text: 'and continues on the next line.', top: 212, bottom: 222, left: 24 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      {
        index: 0,
        blocks: [
          { kind: 'heading', headingLevel: 1, text: 'Heading' },
          { kind: 'unordered-list', text: 'List item' },
          {
            kind: 'paragraph',
            text: 'Shifted body text starts here and continues on the next line.',
          },
        ],
      },
    ]);
  });

  it('removes a soft-wrap hyphen before a lowercase continuation', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(
      0,
      [
        { text: 'They are talk-', top: 150, bottom: 160 },
        { text: 'ing about sets.', top: 162, bottom: 172 },
      ],
      0,
      800,
    );
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as unknown as FoliateView;

    const [source] = getVisiblePDFPageSources(view);
    expect(source?.blocks).toEqual([{ kind: 'paragraph', text: 'They are talking about sets.' }]);
    expect(source?.blocks[0]?.text).not.toContain('talk- ing');
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
