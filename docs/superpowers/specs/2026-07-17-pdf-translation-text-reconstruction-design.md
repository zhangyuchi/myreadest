# PDF Translation Text Reconstruction Design

## Goal

Reconstruct readable PDF paragraphs before requesting translation, so visual line wraps do not split
sentences, normal first-line indents do not become block quotes, and the source-aligned translation
pane receives one complete source paragraph per translated block.

## Scope

This changes only PDF text-layer extraction in `pdfTranslation.ts` and its focused unit tests. The
translation controller, providers, Markdown renderer, page order, retry state, and external pane
layout remain unchanged. Header and footer filtering continues to run before line reconstruction.

## Line reconstruction

The extractor continues to build visual lines from spans on the same baseline. It then groups
adjacent prose lines into paragraph candidates before assigning Markdown block kinds.

A new prose paragraph begins at the first prose line, after a heading or list, after a material
vertical gap, or when an indented line follows a body-left line. The latter rule treats a PDF
first-line indent as a paragraph boundary. A following body-left line is a continuation of that
paragraph, not a new paragraph or a quote.

Within a paragraph candidate, visual lines are joined with one space. If a preceding line ends in a
hyphen and the following line begins with a lowercase letter, the lines are joined without the
space, preventing artificial `talk- ing`-style words.

## Block classification

Headings and list items remain standalone source blocks. Quote recognition happens only after a
prose paragraph candidate is complete: it requires every line in that candidate to remain
substantially offset from the page body-left coordinate. A single indented first line is therefore
always an ordinary paragraph.

When geometry is ambiguous, the extractor prefers a normal paragraph. It must not invent a quote,
because an incorrect quote boundary visibly changes the translation layout and sends a shorter,
less coherent request to the provider.

## Verification

Focused extraction tests will prove that:

- screenshot-shaped body lines are joined into complete paragraphs before translation;
- a normal first-line indent starts a new paragraph and is not rendered as a block quote;
- a consistently indented multi-line paragraph is still classified as a block quote;
- hyphenated visual wraps rejoin without an artificial space; and
- headings, lists, edge filtering, same-baseline span joining, and iframe non-mutation retain their
existing behaviour.
