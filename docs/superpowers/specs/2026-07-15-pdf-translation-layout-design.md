# PDF Translation Layout Preservation Design

## Goal

Keep PDF translation paragraphs aligned with the source page's body paragraphs, while excluding
page headers and footers from translation and display.

## Scope

This change applies only to the PDF-specific translation path. EPUB translation, PDF rendering,
and the original PDF text layer remain unchanged.

## Source extraction

The PDF text layer exposes positioned text spans. For every visible page, extraction will:

1. Read non-empty text spans and their bounds relative to the text-layer bounds.
2. Exclude spans whose vertical center is in the upper 8% or lower 8% of the page. These are
   treated as page header and footer content. Body text in those fixed edge bands is intentionally
   excluded as part of this user-selected behaviour.
3. Group the remaining spans into visual lines by near-equal vertical position, then order each
   line left-to-right.
4. Join adjacent lines into a paragraph unless their vertical gap indicates a paragraph break.

The result is a page source containing an ordered `paragraphs` array, plus a joined text view only
where language detection needs a sample.

## Translation and display

Each page sends its complete `paragraphs` array in one translator call. The controller accepts a
result only when it returns a non-empty translation for every source paragraph. It stores the
translations as an ordered paragraph array, rather than a page-wide string.

The external PDF translation pane renders one paragraph element for each translated paragraph. It
does not inject nodes into the PDF iframe and retains its existing loading, error, retry, page
ordering, and stale-result protections.

## Failure handling

If extraction finds no body paragraphs, the existing no-selectable-text path applies. If a provider
returns a different number of paragraph translations, the page enters the existing explicit error
state instead of displaying a potentially misaligned result. Retry resends that page's original
paragraph array.

## Verification

Focused tests will prove that:

- text from the top and bottom edge bands is not passed to the translator;
- body text is reconstructed as ordered paragraphs;
- a translated paragraph array is rendered as separate paragraphs in matching order;
- a mismatched translator response is reported as an error rather than rendered.
