# PDF Translation Layout Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve PDF body-paragraph boundaries in translated output and exclude page headers and footers from translation and display.

**Architecture:** Replace page-wide `.textContent` extraction with geometry-aware text-span extraction. It filters the top and bottom page edge bands, groups the remaining spans into visual lines and paragraphs, and passes ordered paragraph arrays through the existing controller to the external translation pane.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, PDF.js text-layer DOM.

## Global Constraints

- Apply only to the PDF-specific translation path; EPUB translation, PDF rendering, and the PDF iframe remain untouched.
- Exclude text whose vertical center lies in the upper 8% or lower 8% of its text layer.
- A provider response with a different paragraph count or an empty paragraph becomes an explicit page error.
- Preserve load, text-layer-rendered, retry, stale-result, accessibility, and visible-page order behaviour.
- Add no dependencies.

---

## File Structure

- `apps/readest-app/src/app/reader/utils/pdfTranslation.ts`: positioned span extraction into body paragraphs.
- `apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts`: translation of aligned paragraph arrays.
- `apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx`: visual paragraph rendering.
- Existing utility, hook, pane, and integration tests: boundary regressions.

### Task 1: Extract visible PDF body paragraphs

**Files:**
- Modify: `apps/readest-app/src/app/reader/utils/pdfTranslation.ts`
- Modify: `apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts`

**Interfaces:**
- Produces: `PDFPageSource { index: number; paragraphs: string[] }` from `getVisiblePDFPageSources(view)`.
- Consumes: `.textLayer` span bounds from PDF.js.

- [ ] **Step 1: Write the failing extraction test**

Use a text layer with positioned spans: a header centered at `40`, a footer centered at `970`, two
normal-gap lines for the first body paragraph, and a large-gap second body paragraph. The layer
rectangle must be `top: 0, bottom: 1000`.

```tsx
expect(getVisiblePDFPageSources(view)).toEqual([
  {
    index: 0,
    paragraphs: ['First body line. It continues.', 'Second paragraph.'],
  },
]);
```

The fixture must retain assertions that offscreen pages are ignored and no `.translation-target` is
created in the iframe document.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts`

Expected: FAIL because the current extraction returns one flattened `text` value containing header
and footer text.

- [ ] **Step 3: Implement geometry-aware extraction**

Replace the source shape and add these local units:

```ts
export interface PDFPageSource {
  index: number;
  paragraphs: string[];
}

type PositionedText = { text: string; rect: DOMRect };
const PAGE_EDGE_RATIO = 0.08;

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
  // Build ordered lines from spans with a vertical-center difference no greater than
  // max(2 px, half of the taller span height), insert a space only when the horizontal
  // gap exceeds 20% of the shorter adjacent span height, then split on line gaps greater
  // than half the median line height. Return non-empty paragraphs joined with one space.
}
```

Join adjacent spans only when their horizontal geometry shows a word gap. Join lines in the same
paragraph with one space. `getVisiblePDFPageSources` must drop pages with no body paragraphs and
must not modify the iframe document.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts`

Expected: PASS; header/footer spans are absent and body paragraphs remain ordered.

- [ ] **Step 5: Commit**

Run: `git add apps/readest-app/src/app/reader/utils/pdfTranslation.ts apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts && git commit -m "feat: preserve PDF body paragraphs"`

### Task 2: Translate and validate paragraph arrays

**Files:**
- Modify: `apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts`
- Modify: `apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx`

**Interfaces:**
- Consumes: `PDFPageSource { index, paragraphs }` from Task 1.
- Produces: `PDFPageTranslation { index, sourceParagraphs, translatedParagraphs?, status, error? }`.
- Calls: `translate(sourceParagraphs, { source, target })` once per visible page.

- [ ] **Step 1: Write failing controller tests**

Update source fixtures to arrays and assert aligned storage and request data:

```tsx
mocks.getSources.mockReturnValue([
  { index: 0, paragraphs: ['First body paragraph.', 'Second body paragraph.'] },
]);
mocks.translate.mockResolvedValue(['第一段。', '第二段。']);

await waitFor(() =>
  expect(result.current.pages[0]).toEqual(
    expect.objectContaining({
      status: 'translated',
      translatedParagraphs: ['第一段。', '第二段。'],
    }),
  ),
);
```

Add a separate response of `['only one paragraph']` for two source paragraphs and assert `status`
is `error` with no `translatedParagraphs`. Update retry and stale-result fixtures to use
`sourceParagraphs`.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx`

Expected: FAIL because the current code sends `[source.text]` and stores `translatedText`.

- [ ] **Step 3: Implement aligned response handling**

Replace page fields with:

```ts
sourceParagraphs: string[];
translatedParagraphs?: string[];
```

Build detector samples with `sources.flatMap((source) => source.paragraphs)`. Trim every provider
result; only store the array when its length equals the source array length and every value is
non-empty. Otherwise set `Translation did not return one result for each paragraph.` Retry must
resend `sourceParagraphs` and use the same validation and generation checks.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx`

Expected: PASS; aligned arrays translate/retry and mismatched results are explicit errors.

- [ ] **Step 5: Commit**

Run: `git add apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx && git commit -m "feat: align PDF translation paragraphs"`

### Task 3: Render aligned translated paragraphs

**Files:**
- Modify: `apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx`
- Modify: `apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx`
- Modify: `apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx`

**Interfaces:**
- Consumes: `PDFPageTranslation.translatedParagraphs` from Task 2.
- Produces: one ordered `<p>` per translated body paragraph in the external pane.

- [ ] **Step 1: Write failing pane and flow tests**

Change fixtures to paragraph arrays. Assert two translations are separate paragraphs:

```tsx
const paragraphs = screen.getAllByText(/第一段。|第二段。/);
expect(paragraphs).toHaveLength(2);
expect(paragraphs.map((paragraph) => paragraph.tagName)).toEqual(['P', 'P']);
```

Update the flow fixture to have positioned header, body, and footer spans. Assert that the
translator receives only body paragraphs and the iframe still has no `.translation-target`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx`

Expected: FAIL because the pane only renders a single `translatedText` string.

- [ ] **Step 3: Implement paragraph display**

Use `sourceParagraphs.join('\u001f')` in the visible-page key. Render the successful result with:

```tsx
{page.translatedParagraphs?.map((paragraph, paragraphIndex) => (
  <p key={`${page.index}:${paragraphIndex}`} className='mb-4 last:mb-0 text-base leading-relaxed'>
    {paragraph}
  </p>
))}
```

Retain the article, page heading, pending status, error alert, retry button, and scroll reset.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx`

Expected: PASS; source paragraph order becomes display paragraph order, with edge text absent.

- [ ] **Step 5: Commit**

Run: `git add apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx && git commit -m "feat: render aligned PDF translation paragraphs"`

### Task 4: Verify the complete PDF path

**Files:**
- Verify only; no source changes expected.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: regression evidence for extraction, controller, pane, language handling, and viewer routing.

- [ ] **Step 1: Run the PDF regression suite**

Run: `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run src/__tests__/services/translators/pdfLanguage.test.ts src/__tests__/app/reader/utils/pdfTranslation.test.ts src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/app/reader/components/PDFTranslationPane.test.tsx src/__tests__/app/reader/PDFTranslationFlow.test.tsx src/__tests__/app/reader/FoliateViewerPDFTranslationLayout.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run mechanical checks**

Run: `pnpm --dir apps/readest-app lint && pnpm --dir apps/readest-app format:check && git diff --check`

Expected: all commands exit `0`.
