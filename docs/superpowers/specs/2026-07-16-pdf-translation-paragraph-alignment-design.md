# PDF Translation Paragraph Alignment Design

## Goal

Keep each PDF source block aligned with exactly one rendered translation block. A translated
paragraph must never merge with, or be split across, a neighbouring source paragraph because of
page-level Markdown parsing.

## Scope

This changes only the PDF external translation pane. It preserves the existing source extraction,
provider requests, language detection, error/retry state, page ordering, and raw-HTML safety
boundary. EPUB translation and provider implementations remain unchanged.

## Data model

`PDFPageTranslation` will replace its page-wide `translatedMarkdown` string with an ordered
translation-block collection. Each item retains its `PDFSourceBlock` and the escaped, source-kind
Markdown text for its one provider result. The controller still rejects count-mismatched or blank
provider responses before it publishes the page.

The source block is the alignment key. The translation pane must not attempt to infer paragraph
boundaries from translated text or inserted Markdown blank lines.

## Rendering

The pane renders ordinary paragraphs, headings, and blockquotes one source block at a time, using
the existing safe `ReactMarkdown` configuration without raw HTML. This gives each source paragraph
its own DOM block and stable vertical boundary.

Adjacent unordered-list blocks are rendered together as one list, and adjacent ordered-list blocks
are rendered together as one ordered list. Their individual list items remain ordered one-to-one
with their respective source blocks. A list group ends when its kind changes or any non-list block
appears.

Provider text remains normalized and escaped before its source-derived Markdown wrapper is added;
the provider cannot create headings, lists, quotes, or raw DOM itself.

## Failure handling

The existing per-page error and retry flow remains unchanged. A retry reconstructs the same ordered
translation-block collection from the immutable source blocks, so it has the same alignment rules as
the initial request.

## Verification

Focused tests will prove that:

- two adjacent source paragraphs render as two distinct translated paragraphs even when provider
  output has arbitrary whitespace;
- headings and blockquotes stay independently aligned;
- adjacent list items form one visual list while retaining their item order;
- retry uses the same block-level rendering data; and
- raw HTML remains inert.
