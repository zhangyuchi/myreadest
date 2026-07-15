# PDF Translation Reliability Design

**Date:** 2026-07-14
**Status:** Approved for planning

## Validation

The implementation has focused automated coverage, but this document remains `Approved for
planning` until the planned interactive PDF smoke test is executed. No browser smoke-test result is
claimed here.

- `pnpm --dir apps/readest-app exec vitest run` was run without the app dotenv wrapper and failed
  broadly after Node reported: ``Warning: `--localstorage-file` was provided without a valid
  path``. This suite is not recorded as green.
- `pnpm --dir apps/readest-app exec dotenv -e .env -e .env.test.local -- vitest run` for the nine
  PDF regression files passed: 9 test files and 53 tests. This includes the focused pending-state
  accessibility assertion added during final verification.
- `pnpm --dir apps/readest-app lint` exited 2 on the two existing direct `FoliateView` test casts
  in `src/__tests__/app/reader/utils/pdfTranslation.test.ts` at lines 44 and 58 (`TS2352`). No
  unrelated cast change was made.
- `pnpm --dir apps/readest-app format:check` passed (`Checked 1754 files in 3s. No fixes
  applied.`), and `git diff --check` passed.
- `git diff origin/main...HEAD -- apps/readest-app/src/services/translators
  apps/readest-app/src/app/reader apps/readest-app/src/utils/walk.ts packages/foliate-js/pdf.js
  docs/superpowers` was reviewed. The PDF path has no iframe translation-node append, provider
  failures are not converted to source text, and PDF language resolution falls back to `AUTO`.
  The EPUB-only `detected === 'und'` branch is bypassed for PDF callers.

## Context

PDF translation currently has three independent failure paths:

1. Successful translations are appended to the PDF iframe body after the fixed-height canvas, so
   most or all translated text is outside the visible page viewport.
2. PDFs without language metadata must pass LLM language detection before translation is
   scheduled. If the LLM is not configured or reachable, translation stops even when Google is the
   selected translation provider.
3. The LLM provider converts model, network, timeout, and empty-response failures into the original
   source text. The reader then treats the unchanged result as a no-op, so the user receives no
   useful failure signal.

All three defects are in scope. Fixing only one still leaves a production path where PDF body
translation appears not to work.

## Decisions

### Source and translation are displayed together

PDF translated text is not injected into the PDF iframe. The original PDF remains unchanged in its
existing Foliate fixed-layout viewer, while a synchronized translation pane is rendered by the
reader UI beside it.

- Wide layouts show the PDF and translation pane side by side.
- Narrow/mobile layouts show the PDF above the translation pane.
- The translation pane has its own scrolling area.
- Disabling translation removes the pane and returns the full area to the PDF.
- Page turns replace the pane content with translations for the newly visible page or spread.

This preserves PDF canvas sizing, zoom, annotations, selection, page turns, and spread layout.

### Language detection is best effort

When PDF language metadata is absent, the currently configured LLM provider may be used to detect
the source language. Missing configuration, unavailable Ollama, timeouts, malformed responses, and
other detection failures resolve to `AUTO` and must not block body translation.

The system does not assume English for control-flow decisions. Only trusted metadata or a
successful detection can be used to decide that the source already matches the target language.

### Translation failures are explicit

Translation providers must not return the source text as a substitute for an API/model failure.
Failures propagate through `useTranslator` into the PDF translation state. The translation pane
shows a localized error with a retry action, and failed output is not written to the translation
cache.

## Goals

- Display original PDF content and translated text simultaneously.
- Keep translated content visible without changing the fixed-layout PDF document.
- Synchronize translation content with the visible PDF page or spread.
- Allow unknown-language PDFs to translate when no LLM detector is available.
- Keep Google translation independent from AI/LLM availability.
- Surface translation failures and allow retry.
- Prevent stale async detection or translation results from appearing after a page turn.
- Cover each production failure path with a focused regression test.

## Non-goals

- Modifying PDF files or persisting translations into a PDF.
- Persisting detected language into book metadata.
- Adding a new language-detection service.
- Changing EPUB translation layout or behavior.
- Redesigning general reader navigation, PDF zoom, or annotation handling.
- Adding new translation or AI settings.

## Architecture

### PDF translation state

PDF translation uses view-level state rather than iframe DOM mutations. Each visible page has a
state entry containing:

- Page index and stable page key.
- Extracted source text.
- Resolved source language and provenance.
- Translation status: `idle`, `detecting`, `translating`, `translated`, or `error`.
- Translated text when successful.
- User-facing error information when failed.
- A request generation used to reject stale async results.

The state is scoped to the current reader view and released when the book closes.

### Translation pane

A PDF-only translation pane is owned by `FoliateViewer`, outside the `foliate-view` element and its
iframes.

- On wide layouts, the viewer container becomes a horizontal split. The PDF and translation pane
  each receive usable width; the pane is independently scrollable.
- On narrow layouts, the container becomes a vertical split. The PDF remains visible in the upper
  region and the translation pane scrolls in the lower region.
- For a single visible page, the pane shows one translated section.
- For a two-page spread, it shows both page translations in reading order with page labels.
- A page/spread change scrolls the translation pane to its beginning.
- Existing theme and e-ink surface primitives are reused; no styles are injected into iframe
  documents.

The existing translation toggle controls whether the pane exists. PDF mode does not append
`.translation-target` elements to the PDF page body.

### Source extraction

The existing rendered PDF `.textLayer` remains the source of selectable text. Extraction occurs
after the page text layer has rendered and produces one source block per visible page.

- Empty text layers retain the existing scanned/image-PDF informational message.
- Text extraction and translation pane rendering are separate operations.
- Re-rendering a text layer after zoom does not create duplicate translation UI.
- Existing translation cache keys continue to use source text, source language, target language,
  and provider.

## Language Resolution

The flow resolves both a language and its provenance:

| Situation | Resolved language | Provenance | May skip as same language? |
| --- | --- | --- | --- |
| Valid PDF metadata | Metadata language | `metadata` | Yes |
| Successful LLM detection | Detected ISO language | `detected` | Yes |
| LLM not configured | `AUTO` | `fallback` | No |
| Detection request fails | `AUTO` | `fallback` | No |
| Detection response is invalid or `und` | `AUTO` | `fallback` | No |

`AUTO` means unknown, not English. Google sends it as `sl=auto`; the LLM translation prompt asks
the model to infer the source language.

## End-to-End Data Flow

1. The PDF renderer reports the currently visible page or spread.
2. The translation controller obtains each visible page's rendered `.textLayer` and extracts its
   source text.
3. If book metadata contains a valid primary language, use it. Otherwise attempt detection with the
   configured LLM.
4. If detection is unavailable or fails, resolve the source to `AUTO` and continue.
5. Skip translation only when trusted metadata or successful detection matches the target language.
6. Translate each visible page as a page-sized block through the selected translation provider.
7. Store successful results in the existing translation cache and publish them to the synchronized
   pane.
8. On page turn, create a new request generation. Results from earlier generations are ignored.
9. On error, publish an error state to the corresponding page section and leave the original PDF
   visible.
10. Retry starts a fresh request generation for the failed page or spread.

## Error Handling

### Detection

- Missing LLM configuration is an expected fallback, not an error.
- Network errors, unavailable Ollama, timeouts, invalid language codes, and `und` resolve to `AUTO`.
- Detection failure must not show “translation is not available,” because translation remains
  available through source auto-detection.
- Loading state is cleared on every detection outcome.

### Translation

- Single-text model/API failures propagate instead of returning the source text.
- Batch formatting mismatch may retry per text, but any failed retry remains an explicit failure;
  it is not replaced with the source text.
- Empty model output is an explicit failure.
- Failed or empty output is not cached.
- The pane displays a localized failure message and retry action.
- An unchanged successful response is displayed rather than silently removing the pane; source
  equality alone is not proof of an API failure.

### Lifecycle

- Disabling translation invalidates active generations and hides the pane.
- Page turns and view replacement invalidate earlier detection and translation results.
- Closing the reader releases page translation state and observers.
- Failures in one page of a spread do not remove a successful translation for the other page.

## Implementation Boundaries

- Keep language resolution as a testable operation separate from DOM observation.
- Keep PDF page extraction separate from translation-provider calls.
- Keep the pane as a PDF-specific reader component; do not add PDF branches to EPUB target-node
  rendering.
- Reuse the existing translation provider registry, `useTranslator`, cache, themes, and reader
  translation toggle.
- Do not add dependencies or generic abstractions without another current caller.

## Tests

### Language resolution

1. Valid metadata bypasses LLM detection.
2. Successful detection different from the target permits translation.
3. Successful detection equal to the target skips translation.
4. Missing LLM configuration resolves to `AUTO` and permits translation.
5. Unavailable Ollama resolves to `AUTO` and permits translation.
6. Invalid or `und` output resolves to `AUTO` and permits translation.
7. Fallback with an English target does not skip an unknown-language PDF.

### Provider error behavior

1. Single-text model rejection propagates through `llmProvider` and `useTranslator`.
2. Empty model output is reported as failure.
3. Failed per-text batch fallback does not return source text as success.
4. Failed output is not stored in the translation cache.

### PDF integration and pane

1. A rendered PDF text layer produces a visible translation-pane section.
2. No `.translation-target` element is appended to the PDF iframe body.
3. Original PDF and translation pane are both rendered in wide and narrow layouts.
4. Two-page spreads render two translated sections in reading order.
5. Page turns replace pane content and reset pane scroll position.
6. A late result from the previous page is ignored.
7. Translation failure renders an error and retry action.
8. Empty text layers retain the scanned-PDF message.
9. Disabling translation removes the pane and invalidates pending work.

The principal regression test must drive the PDF text-layer-to-pane path and assert visible
translated content. Provider-only tests are insufficient.

## Success Criteria

- A successful PDF translation is visible beside the original page.
- Original PDF content, zoom, selection, annotations, and page turns continue to work.
- Unknown-language PDFs translate through Google or LLM when detection is unavailable.
- Model/API failures are visible and retryable rather than appearing as untranslated source text.
- Page turns cannot publish stale translation results.
- Focused regression tests cover all three originally observed failure paths.
