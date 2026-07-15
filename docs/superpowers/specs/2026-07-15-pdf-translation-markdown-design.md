# PDF Translation Markdown Rendering Design

## Goal

Render PDF translations as Markdown while preserving source-derived block structure for every
translation provider, including plain-text Google Translate responses.

## Scope

This applies only to the PDF external translation pane. EPUB translation, PDF iframe rendering,
provider implementations, and raw HTML rendering remain unchanged.

## Source block model

The existing positioned PDF body-line extraction will classify each body block before translation:

- `heading`: a line whose visual height is significantly larger than the page's median body-line
  height. Relative size selects Markdown level `#`, `##`, or `###`.
- `unordered-list`: a line beginning with a PDF bullet glyph or `-`/`*` marker; the marker is
  removed before translation and deterministically restored as `- `.
- `ordered-list`: a line beginning with a numeric `1.` or `1)` marker; the marker is removed
  before translation and deterministically restored as `1. `.
- `blockquote`: a non-list line with a clear left indent relative to ordinary body lines; it is
  rendered with `> `.
- `paragraph`: the default for all remaining body text.

The current upper and lower 8% edge-band filtering still removes page headers and footers before
classification. Inline bold, italic, links, tables, and images are explicitly out of scope because
the PDF text layer does not provide sufficiently reliable semantic structure for them.

## Translation flow

For a visible page, the controller submits the ordered plain-text content of its source blocks to
the selected provider. It continues to require an equally long, non-empty translated array. It then
applies the source block's deterministic Markdown wrapper to the matching translated text. Thus the
translator never has to preserve Markdown tokens, and Google and LLM providers yield the same
rendered block structure.

## Rendering and safety

The pane renders each generated Markdown block with the already-installed `react-markdown` and
`remark-gfm`. Raw HTML is not enabled, so provider output cannot create arbitrary DOM. The pane
keeps its existing loading, retry, error, page ordering, scroll-reset, and accessibility behaviour.

## Failure handling

Any mismatched or blank provider result remains an explicit page error. If classification is
ambiguous, the extractor chooses `paragraph`; it must not invent a heading, list, or quote.

## Verification

Focused tests will prove that:

- headings, unordered/ordered lists, quotes, and paragraphs are classified and wrapped into the
  expected Markdown;
- headers and footers are still excluded before block classification;
- Google-style plain-text translated results acquire the original Markdown structure;
- Markdown is rendered without raw HTML execution; and
- existing count/empty-response error handling and iframe non-mutation remain intact.
