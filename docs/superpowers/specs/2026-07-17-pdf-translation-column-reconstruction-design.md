# PDF Translation Column-Aware Text Reconstruction Design

## Goal

Reconstruct complete PDF paragraphs before translation without allowing quote-heavy content to redefine
the page body margin. Preserve reading order for simple two-column pages and keep normal first-line
indents separate from block quotes.

## Scope

This replaces only the internal geometry stages in apps/readest-app/src/app/reader/utils/pdfTranslation.ts
and extends its focused tests. Provider calls, translation state, Markdown rendering, retry behavior,
and the external translation pane remain unchanged. The user-provided readest.png remains a local,
untracked diagnostic artifact and is not part of the change.

## Column regions and reading order

After edge-band filtering, text spans are grouped into baseline fragments. A wide same-baseline gap
is treated as a potential column split only when that horizontal separation recurs on at least two
baselines. The extractor then assigns fragments to the corresponding left-to-right regions and
processes each region top-to-bottom; page output is the completed left region followed by the
completed right region.

If recurring column evidence is absent, the page remains one region. A single large word gap or a
one-off positioned span must not create a new column.

## Region-local paragraph reconstruction

Each region derives its body-left coordinate from the minimum left coordinate of its non-structural
prose lines. This is deliberately not a median: a block quote may contain more visual lines than
ordinary body text, but it must never become the body margin. A region made entirely of uniformly
shifted prose establishes that shifted position as its own body margin and therefore remains a
paragraph under ambiguous geometry.

Headings and list items remain structural, standalone blocks and do not contribute to body-left.
Consecutive prose lines form one candidate until a structural line, material vertical gap, an
indented first line after body-left prose, or a sufficient outdent from a multi-line quote candidate
starts a new candidate. Candidate text joins visual wraps with one space, except a trailing hyphen
followed by a lowercase letter joins without a space.

A candidate becomes a block quote only if it has at least two lines and every line remains
substantially right of its region body-left coordinate. A first-line-indented paragraph includes a
body-left continuation, so it remains a paragraph. A quote followed by a new paragraph whose first
line is also indented is split by its outdent from the quote's own left margin.

## Failure handling and compatibility

Ambiguous geometry defaults to paragraph. Public PDFPageSource and PDFSourceBlock types, text-layer
non-mutation, edge filtering, source-to-translation alignment, and error/retry checks retain their
current contracts.

## Verification

Focused tests will prove that:

- a quote-heavy region with one body line and two quote lines retains the quote;
- ordinary first-line indents, quote-to-indented-paragraph transitions, and hyphenated visual wraps
  reconstruct complete paragraphs;
- headings/lists do not influence the prose body margin;
- two recurring columns emit all left-column blocks before right-column blocks;
- a one-off wide inline gap does not split a single-column line into columns; and
- existing edge filtering, same-baseline joining, lists, headings, and iframe non-mutation remain
  intact.
