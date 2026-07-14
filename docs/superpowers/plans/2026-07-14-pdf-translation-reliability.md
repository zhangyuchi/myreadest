# PDF Translation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PDF translation reliably show the original PDF beside synchronized translated text, continue with source language `AUTO` when LLM detection is unavailable, and surface provider failures instead of silently returning source text.

**Architecture:** Keep EPUB translation in `useTextTranslation`, but route PDF books through a new view-level `usePDFTranslation` controller. PDF.js emits a composed event when a page text layer finishes rendering; the controller extracts currently visible page text, resolves language with best-effort LLM detection, translates through the existing provider/cache path, rejects stale generations, and supplies state to a responsive `PDFTranslationPane` rendered outside PDF iframes.

**Tech Stack:** TypeScript, React 19, Zustand, Foliate fixed-layout/PDF.js, Vercel AI SDK, Tailwind CSS, Vitest, Testing Library

## Global Constraints

- Preserve PDF canvas size, zoom, selection, annotations, pagination, scroll mode, and two-page spreads.
- Original PDF and translated text must be visible simultaneously when translation is enabled.
- Wide layouts use a side-by-side split; narrow layouts use a vertical split.
- Missing or failed language detection resolves to `AUTO` and never blocks translation.
- Only metadata or a successful detection may trigger the same-language early exit.
- Model/API/timeout/empty-output failures must not be converted into source text or cached.
- Page turns, disabling translation, and view replacement must invalidate stale async results.
- Do not change EPUB translation behavior.
- Do not add dependencies or user settings.
- Follow `apps/readest-app/.agents/rules/test-first.md`: observe every focused regression test fail before implementing its production change.

---

## File Structure

| Operation | File | Responsibility |
| --- | --- | --- |
| Create | `apps/readest-app/src/services/translators/pdfLanguage.ts` | Resolve trusted metadata, detected language, or `AUTO` fallback with provenance. |
| Create | `apps/readest-app/src/app/reader/utils/pdfTranslation.ts` | Extract visible rendered PDF page text without mutating iframe DOM. |
| Create | `apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts` | Coordinate page events, detection, translation, retry, error state, and stale-generation rejection. |
| Create | `apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx` | Render translated page/spread sections, loading, errors, and retry UI. |
| Create | `apps/readest-app/src/__tests__/services/translators/pdfLanguage.test.ts` | Language-resolution regressions. |
| Create | `apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts` | Visible-page extraction and DOM non-mutation tests. |
| Create | `apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx` | Controller lifecycle, failure, retry, and stale-result tests. |
| Create | `apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx` | Pane rendering and interaction tests. |
| Create | `apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx` | Regression path from real iframe text-layer extraction through the controller into the external pane. |
| Create | `apps/readest-app/src/__tests__/hooks/useTranslator.test.tsx` | Verify provider failures propagate through the cache-owning translation hook without writes. |
| Modify | `packages/foliate-js/pdf.js` | Emit `pdf-text-layer-rendered` after each completed text-layer render. |
| Modify | `apps/readest-app/src/services/translators/providers/llm.ts` | Propagate single/batch/empty-output failures. |
| Modify | `apps/readest-app/src/__tests__/services/translators/providers/llm.test.ts` | Replace silent-source fallback expectations with explicit failure expectations. |
| Modify | `apps/readest-app/src/app/reader/components/FoliateViewer.tsx` | Mount the PDF controller and responsive translation pane outside `foliate-view`. |
| Modify | `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts` | Remove the obsolete PDF text-layer DOM-insertion branch only. |
| Modify | `apps/readest-app/src/utils/walk.ts` | Remove PDF `.textLayer` collection from the EPUB DOM walker. |

---

### Task 1: Make LLM translation failures explicit

**Files:**
- Modify: `apps/readest-app/src/services/translators/providers/llm.ts:58-137`
- Modify: `apps/readest-app/src/__tests__/services/translators/providers/llm.test.ts:100-216`
- Create: `apps/readest-app/src/__tests__/hooks/useTranslator.test.tsx`

**Interfaces:**
- Consumes: existing `TranslationProvider.translate(texts, sourceLang, targetLang)` contract.
- Produces: `llmProvider.translate(...)` returns complete translated strings or rejects with an `Error`; it never substitutes source text for provider failure or empty output.

- [ ] **Step 1: Replace silent-fallback tests with failure assertions**

In `llm.test.ts`, replace the existing “returns original text when per-text fallback also fails” and “returns original text when LLM returns empty response” cases, and add a single-text rejection case:

```typescript
it('propagates a single-text model failure', async () => {
  mockGenerateText.mockRejectedValue(new Error('API error'));

  await expect(llmProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow('API error');
});

it('propagates a failed per-text fallback', async () => {
  mockGenerateText
    .mockResolvedValueOnce({ text: 'garbage' })
    .mockRejectedValueOnce(new Error('API error'))
    .mockResolvedValueOnce({ text: 'Monde' });

  await expect(llmProvider.translate(['Hello', 'World'], 'en', 'fr')).rejects.toThrow(
    'API error',
  );
});

it('rejects an empty model response', async () => {
  mockGenerateText.mockResolvedValue({ text: '' });

  await expect(llmProvider.translate(['Hello'], 'en', 'fr')).rejects.toThrow(
    'Translation returned an empty response',
  );
});
```

Create `useTranslator.test.tsx` to cover the existing provider → hook → cache boundary:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslator } from '@/hooks/useTranslator';

const mocks = vi.hoisted(() => ({
  provider: {
    name: 'llm',
    translate: vi.fn(),
  },
  storeInCache: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: undefined }),
}));
vi.mock('@/services/translators', () => ({
  getTranslator: () => mocks.provider,
  getTranslators: () => [mocks.provider],
  isTranslatorAvailable: () => true,
  getFromCache: vi.fn().mockResolvedValue(null),
  storeInCache: mocks.storeInCache,
  preprocess: (texts: string[]) => texts,
  polish: (texts: string[]) => texts,
}));

describe('useTranslator provider failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.translate.mockRejectedValue(new Error('API offline'));
  });

  it('propagates rejection and does not cache failed output', async () => {
    const { result } = renderHook(() =>
      useTranslator({
        provider: 'llm',
        sourceLang: 'en',
        targetLang: 'zh-CN',
        enablePolishing: false,
        enablePreprocessing: false,
      }),
    );

    await act(async () => {
      await expect(result.current.translate(['Hello'])).rejects.toThrow('API offline');
    });
    expect(mocks.storeInCache).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the current implementation fails**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run \
  src/__tests__/services/translators/providers/llm.test.ts \
  src/__tests__/hooks/useTranslator.test.tsx
```

Expected: the LLM-provider assertions FAIL because rejected/empty `generateText` calls currently
resolve to source strings; the hook-boundary assertion passes and proves a rejection will propagate
without a cache write once the provider stops swallowing it.

- [ ] **Step 3: Implement the explicit error contract**

Add this helper near `getLangName`:

```typescript
function requireTranslationText(text: string | undefined): string {
  const translated = text?.trim();
  if (!translated) {
    throw new Error('Translation returned an empty response.');
  }
  return translated;
}
```

Replace the single-text branch with:

```typescript
if (nonEmptyTexts.length === 1) {
  const system = `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}. Output ONLY the translation — no explanations, no extra text.`;
  const result = await generateText({ model, system, prompt: nonEmptyTexts[0]! });
  const results = [...texts];
  results[indices[0]!] = requireTranslationText(result.text);
  return results;
}
```

Replace the batch `try/catch` with one batch call followed by an explicit fallback:

```typescript
const result = await generateText({ model, system, prompt: batchedInput });
const translatedSegments = result.text.split(DELIMITER).map((segment) => segment.trim());

if (
  translatedSegments.length === nonEmptyTexts.length &&
  translatedSegments.every((segment) => segment.length > 0)
) {
  const results = [...texts];
  indices.forEach((originalIndex, index) => {
    results[originalIndex] = translatedSegments[index]!;
  });
  return results;
}

const perTextResults = await Promise.all(
  nonEmptyTexts.map(async (text) => {
    const singleSystem = `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}. Output ONLY the translation — no explanations, no extra text.`;
    const singleResult = await generateText({ model, system: singleSystem, prompt: text });
    return requireTranslationText(singleResult.text);
  }),
);

const results = [...texts];
indices.forEach((originalIndex, index) => {
  results[originalIndex] = perTextResults[index]!;
});
return results;
```

- [ ] **Step 4: Run provider tests and verify they pass**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run \
  src/__tests__/services/translators/providers/llm.test.ts \
  src/__tests__/services/translators/providers.test.ts \
  src/__tests__/hooks/useTranslator.test.tsx
```

Expected: 3 test files pass with no failed tests.

- [ ] **Step 5: Commit the provider error-contract change**

```bash
git add \
  apps/readest-app/src/services/translators/providers/llm.ts \
  apps/readest-app/src/__tests__/services/translators/providers/llm.test.ts \
  apps/readest-app/src/__tests__/hooks/useTranslator.test.tsx
git commit -m "fix: surface LLM translation failures"
```

---

### Task 2: Resolve unknown PDF languages without blocking translation

**Files:**
- Create: `apps/readest-app/src/services/translators/pdfLanguage.ts`
- Create: `apps/readest-app/src/__tests__/services/translators/pdfLanguage.test.ts`

**Interfaces:**
- Consumes: `detectLanguage(text): Promise<string>` and `isSameLang(source, target)`.
- Produces:
  - `PDFSourceLanguage` with `language`, `provenance`, and `skipTranslation`.
  - `resolvePDFSourceLanguage(input): Promise<PDFSourceLanguage>`.

- [ ] **Step 1: Write language-resolution tests**

Create `pdfLanguage.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { resolvePDFSourceLanguage } from '@/services/translators/pdfLanguage';

describe('resolvePDFSourceLanguage', () => {
  it('trusts metadata and bypasses detection', async () => {
    const detect = vi.fn();
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: 'fr',
      targetLanguage: 'zh-CN',
      sample: 'Bonjour',
      detect,
    });

    expect(result).toEqual({ language: 'fr', provenance: 'metadata', skipTranslation: false });
    expect(detect).not.toHaveBeenCalled();
  });

  it('skips only after a successful same-language detection', async () => {
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: 'und',
      targetLanguage: 'en-US',
      sample: 'Hello',
      detect: vi.fn().mockResolvedValue('en'),
    });

    expect(result).toEqual({ language: 'en', provenance: 'detected', skipTranslation: true });
  });

  it('ignores malformed metadata and uses successful detection', async () => {
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: 'English',
      targetLanguage: 'zh-CN',
      sample: 'Bonjour',
      detect: vi.fn().mockResolvedValue('fr'),
    });

    expect(result).toEqual({ language: 'fr', provenance: 'detected', skipTranslation: false });
  });

  it.each([
    ['und', vi.fn().mockResolvedValue('und')],
    ['invalid output', vi.fn().mockResolvedValue('English')],
    ['provider failure', vi.fn().mockRejectedValue(new Error('offline'))],
  ])('falls back to AUTO for %s and still permits translation', async (_name, detect) => {
    const result = await resolvePDFSourceLanguage({
      metadataLanguage: '',
      targetLanguage: 'en',
      sample: '未知语言',
      detect,
    });

    expect(result).toEqual({ language: 'AUTO', provenance: 'fallback', skipTranslation: false });
  });
});
```

- [ ] **Step 2: Run the new tests and verify the module is missing**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/services/translators/pdfLanguage.test.ts
```

Expected: FAIL because `@/services/translators/pdfLanguage` does not exist.

- [ ] **Step 3: Implement the language resolver**

Create `pdfLanguage.ts`:

```typescript
import { detectLanguage } from '@/services/translators/providers/llm';
import { isSameLang, isValidLang } from '@/utils/lang';

export type PDFLanguageProvenance = 'metadata' | 'detected' | 'fallback';

export interface PDFSourceLanguage {
  language: string;
  provenance: PDFLanguageProvenance;
  skipTranslation: boolean;
}

interface ResolvePDFSourceLanguageInput {
  metadataLanguage?: string | null;
  targetLanguage: string;
  sample: string;
  detect?: (text: string) => Promise<string>;
}

const normalizeLanguage = (language: string): string | null => {
  const normalized = language.trim().toLowerCase();
  return isValidLang(normalized) ? normalized : null;
};

export async function resolvePDFSourceLanguage({
  metadataLanguage,
  targetLanguage,
  sample,
  detect = detectLanguage,
}: ResolvePDFSourceLanguageInput): Promise<PDFSourceLanguage> {
  const metadata = normalizeLanguage(metadataLanguage ?? '');
  if (metadata) {
    return {
      language: metadata,
      provenance: 'metadata',
      skipTranslation: isSameLang(metadata, targetLanguage),
    };
  }

  try {
    const detected = normalizeLanguage(await detect(sample));
    if (detected) {
      return {
        language: detected,
        provenance: 'detected',
        skipTranslation: isSameLang(detected, targetLanguage),
      };
    }
  } catch (error) {
    console.warn('PDF language detection failed; continuing with AUTO.', error);
  }

  return { language: 'AUTO', provenance: 'fallback', skipTranslation: false };
}
```

- [ ] **Step 4: Run the resolver tests**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/services/translators/pdfLanguage.test.ts
```

Expected: 1 test file passes with all parameterized cases green.

- [ ] **Step 5: Commit the resolver**

```bash
git add apps/readest-app/src/services/translators/pdfLanguage.ts apps/readest-app/src/__tests__/services/translators/pdfLanguage.test.ts
git commit -m "fix: fall back to auto language for PDFs"
```

---

### Task 3: Publish completed PDF text layers and extract visible page sources

**Files:**
- Modify: `packages/foliate-js/pdf.js:231-268`
- Create: `apps/readest-app/src/app/reader/utils/pdfTranslation.ts`
- Create: `apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts`

**Interfaces:**
- Produces: composed `pdf-text-layer-rendered` event dispatched from the rendered page iframe.
- Produces: `PDFPageSource { index: number; text: string }` and `getVisiblePDFPageSources(view)`.

- [ ] **Step 1: Write visible-page extraction tests**

Create `pdfTranslation.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { getVisiblePDFPageSources } from '@/app/reader/utils/pdfTranslation';
import type { FoliateView } from '@/types/view';

const rect = (top: number, bottom: number): DOMRect =>
  ({ top, bottom, left: 0, right: 600, width: 600, height: bottom - top, x: 0, y: top, toJSON: vi.fn() }) as DOMRect;

const makePage = (index: number, text: string, top: number, bottom: number) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframe.getBoundingClientRect = () => rect(top, bottom);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = `<div class="textLayer"><span>${text}</span></div>`;
  return { doc, index };
};

describe('getVisiblePDFPageSources', () => {
  it('returns visible page text in renderer order and ignores offscreen pages', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const contents = [
      makePage(2, 'Second page', 0, 400),
      makePage(3, 'Third page', 400, 800),
      makePage(4, 'Offscreen page', 900, 1300),
    ];
    const view = { renderer: Object.assign(renderer, { getContents: () => contents }) } as FoliateView;

    expect(getVisiblePDFPageSources(view)).toEqual([
      { index: 2, text: 'Second page' },
      { index: 3, text: 'Third page' },
    ]);
  });

  it('does not append translation nodes to the PDF document', () => {
    const renderer = document.createElement('div');
    renderer.getBoundingClientRect = () => rect(0, 800);
    const page = makePage(0, 'Source text', 0, 800);
    const view = {
      renderer: Object.assign(renderer, { getContents: () => [page] }),
    } as FoliateView;

    getVisiblePDFPageSources(view);

    expect(page.doc.querySelector('.translation-target')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the extraction tests and verify they fail**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts
```

Expected: FAIL because the utility module does not exist.

- [ ] **Step 3: Implement non-mutating visible-page extraction**

Create `pdfTranslation.ts`:

```typescript
import type { FoliateView } from '@/types/view';

export interface PDFPageSource {
  index: number;
  text: string;
}

const intersects = (page: DOMRect, viewport: DOMRect) =>
  page.bottom > viewport.top &&
  page.top < viewport.bottom &&
  page.right > viewport.left &&
  page.left < viewport.right;

export function getVisiblePDFPageSources(view: FoliateView): PDFPageSource[] {
  const viewport = view.renderer.getBoundingClientRect();
  return view.renderer
    .getContents()
    .filter((content): content is { doc: Document; index: number; overlayer?: unknown } => {
      if (content.index == null) return false;
      const frame = content.doc.defaultView?.frameElement;
      return frame instanceof HTMLElement && intersects(frame.getBoundingClientRect(), viewport);
    })
    .map(({ doc, index }) => ({
      index,
      text: doc.querySelector('.textLayer')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    }))
    .filter(({ text }) => text.length > 0);
}
```

- [ ] **Step 4: Emit a composed event after PDF.js finishes each text layer**

In `packages/foliate-js/pdf.js`, immediately after appending `endOfContent`, add:

```javascript
    doc.defaultView?.frameElement?.dispatchEvent(new CustomEvent(
        'pdf-text-layer-rendered', {
            bubbles: true,
            composed: true,
            detail: { doc },
        }))
```

This event is emitted after `await textLayer.render()` and after the final selection helper node is
present, so the React controller never has to guess with a timeout.

- [ ] **Step 5: Run extraction tests and Foliate PDF-adjacent tests**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/utils/pdfTranslation.test.ts src/__tests__/document/pdf-tts.test.ts
```

Expected: both test files pass with no failed tests.

- [ ] **Step 6: Commit the renderer boundary**

```bash
git add packages/foliate-js/pdf.js apps/readest-app/src/app/reader/utils/pdfTranslation.ts apps/readest-app/src/__tests__/app/reader/utils/pdfTranslation.test.ts
git commit -m "feat: expose rendered PDF text layers"
```

---

### Task 4: Add the PDF translation controller

**Files:**
- Create: `apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts`
- Create: `apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx`

**Interfaces:**
- Consumes: `getVisiblePDFPageSources(view)`, `resolvePDFSourceLanguage(...)`, `useTranslator(...).translate`.
- Produces:
  - `PDFPageTranslation` page state.
  - `usePDFTranslation(bookKey, view)` returning `{ pages, retryPage }`.

- [ ] **Step 1: Write controller tests for fallback, success, errors, and stale results**

Create `usePDFTranslation.test.tsx` with hoisted mocks for `useTranslator`, reader/book stores,
`useBookProgress`, language resolution, and page extraction. Use this core test shape:

```typescript
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateView } from '@/types/view';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';

const mocks = vi.hoisted(() => ({
  translate: vi.fn(),
  resolveLanguage: vi.fn(),
  getSources: vi.fn(),
  progress: { index: 0 },
  settings: {
    translationEnabled: true,
    translationProvider: 'google',
    translateTargetLang: 'zh-CN',
  },
  bookData: { book: { format: 'PDF', primaryLanguage: '' } },
  toast: vi.fn(),
  translateUI: (text: string) => text,
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({ translate: mocks.translate }),
}));
vi.mock('@/services/translators/pdfLanguage', () => ({
  resolvePDFSourceLanguage: mocks.resolveLanguage,
}));
vi.mock('@/app/reader/utils/pdfTranslation', () => ({
  getVisiblePDFPageSources: mocks.getSources,
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.progress,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({
      getViewSettings: () => mocks.settings,
      setIsLoading: vi.fn(),
    }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({ getBookData: () => mocks.bookData }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => mocks.translateUI,
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: mocks.toast },
}));

const makeView = () => document.createElement('div') as FoliateView;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.progress.index = 0;
  mocks.settings.translationEnabled = true;
  mocks.settings.translationProvider = 'google';
  mocks.settings.translateTargetLang = 'zh-CN';
  mocks.bookData.book.primaryLanguage = '';
});
```

Add these assertions after the setup:

```typescript
it('translates with AUTO when detection falls back', async () => {
  mocks.getSources.mockReturnValue([{ index: 0, text: 'Hello PDF' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'AUTO',
    provenance: 'fallback',
    skipTranslation: false,
  });
  mocks.translate.mockResolvedValue(['你好 PDF']);

  const view = makeView();
  const { result } = renderHook(() => usePDFTranslation('book-1', view));

  await waitFor(() => expect(result.current.pages[0]?.status).toBe('translated'));
  expect(mocks.translate).toHaveBeenCalledWith(['Hello PDF'], {
    source: 'AUTO',
    target: 'zh-CN',
  });
  expect(result.current.pages[0]?.translatedText).toBe('你好 PDF');
});

it('publishes an error instead of source text when translation rejects', async () => {
  mocks.getSources.mockReturnValue([{ index: 0, text: 'Hello PDF' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'detected',
    skipTranslation: false,
  });
  mocks.translate.mockRejectedValue(new Error('API offline'));

  const view = makeView();
  const { result } = renderHook(() => usePDFTranslation('book-1', view));

  await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));
  expect(result.current.pages[0]?.error).toBe('API offline');
  expect(result.current.pages[0]?.translatedText).toBeUndefined();
});

it('ignores a late result after the visible page changes', async () => {
  let resolveFirst!: (texts: string[]) => void;
  mocks.getSources
    .mockReturnValueOnce([{ index: 0, text: 'First page' }])
    .mockReturnValue([{ index: 1, text: 'Second page' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'detected',
    skipTranslation: false,
  });
  mocks.translate
    .mockReturnValueOnce(new Promise<string[]>((resolve) => (resolveFirst = resolve)))
    .mockResolvedValueOnce(['第二页']);

  const view = makeView();
  const { result, rerender } = renderHook(() => usePDFTranslation('book-1', view));
  mocks.progress.index = 1;
  rerender();

  await waitFor(() => expect(result.current.pages[0]?.index).toBe(1));
  await act(async () => resolveFirst(['第一页']));
  expect(result.current.pages).toEqual([
    expect.objectContaining({ index: 1, translatedText: '第二页' }),
  ]);
});

it('skips after a trusted same-language detection', async () => {
  mocks.getSources.mockReturnValue([{ index: 0, text: 'Hello PDF' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'detected',
    skipTranslation: true,
  });

  const view = makeView();
  const { result } = renderHook(() => usePDFTranslation('book-1', view));

  await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  expect(result.current.pages).toEqual([]);
  expect(mocks.translate).not.toHaveBeenCalled();
});

it('keeps two spread pages in renderer order', async () => {
  mocks.getSources.mockReturnValue([
    { index: 4, text: 'Left' },
    { index: 5, text: 'Right' },
  ]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'metadata',
    skipTranslation: false,
  });
  mocks.translate.mockResolvedValueOnce(['左页']).mockResolvedValueOnce(['右页']);

  const view = makeView();
  const { result } = renderHook(() => usePDFTranslation('book-1', view));

  await waitFor(() => expect(result.current.pages.every((page) => page.status === 'translated')).toBe(true));
  expect(result.current.pages.map((page) => page.index)).toEqual([4, 5]);
});

it('refreshes after the PDF text-layer-rendered event', async () => {
  const view = makeView();
  mocks.getSources.mockReturnValueOnce([]).mockReturnValue([{ index: 0, text: 'Ready' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'metadata',
    skipTranslation: false,
  });
  mocks.translate.mockResolvedValue(['就绪']);
  const { result } = renderHook(() => usePDFTranslation('book-1', view));

  act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));

  await waitFor(() => expect(result.current.pages[0]?.translatedText).toBe('就绪'));
});

it('retries only the failed page', async () => {
  mocks.getSources.mockReturnValue([{ index: 0, text: 'Retry me' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'metadata',
    skipTranslation: false,
  });
  mocks.translate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['重试成功']);
  const view = makeView();
  const { result } = renderHook(() => usePDFTranslation('book-1', view));
  await waitFor(() => expect(result.current.pages[0]?.status).toBe('error'));

  act(() => result.current.retryPage(0));

  await waitFor(() => expect(result.current.pages[0]?.translatedText).toBe('重试成功'));
});

it('clears state and ignores pending work when translation is disabled', async () => {
  let resolveTranslation!: (texts: string[]) => void;
  mocks.getSources.mockReturnValue([{ index: 0, text: 'Pending' }]);
  mocks.resolveLanguage.mockResolvedValue({
    language: 'en',
    provenance: 'metadata',
    skipTranslation: false,
  });
  mocks.translate.mockReturnValue(new Promise<string[]>((resolve) => (resolveTranslation = resolve)));
  const view = makeView();
  const { result, rerender } = renderHook(() => usePDFTranslation('book-1', view));
  await waitFor(() => expect(result.current.pages[0]?.status).toBe('translating'));

  mocks.settings.translationEnabled = false;
  rerender();
  await act(async () => resolveTranslation(['迟到结果']));

  expect(result.current.pages).toEqual([]);
});

it('shows the scanned-PDF toast after a rendered empty text layer', async () => {
  const view = makeView();
  mocks.getSources.mockReturnValue([]);
  renderHook(() => usePDFTranslation('book-1', view));

  act(() => view.dispatchEvent(new CustomEvent('pdf-text-layer-rendered')));

  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({ message: expect.stringContaining('No selectable text') }),
    ),
  );
});
```

- [ ] **Step 2: Run the controller tests and verify the hook is missing**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx
```

Expected: FAIL because `usePDFTranslation` does not exist.

- [ ] **Step 3: Implement the complete controller**

Create `usePDFTranslation.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useTranslator } from '@/hooks/useTranslator';
import type { UseTranslatorOptions } from '@/services/translators';
import { resolvePDFSourceLanguage } from '@/services/translators/pdfLanguage';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import { getVisiblePDFPageSources } from '../utils/pdfTranslation';

export type PDFTranslationStatus = 'detecting' | 'translating' | 'translated' | 'error';

export interface PDFPageTranslation {
  index: number;
  sourceText: string;
  sourceLanguage: string;
  status: PDFTranslationStatus;
  translatedText?: string;
  error?: string;
}

export interface UsePDFTranslationResult {
  pages: PDFPageTranslation[];
  retryPage: (index: number) => void;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function usePDFTranslation(
  bookKey: string,
  view: FoliateView | null,
): UsePDFTranslationResult {
  const _ = useTranslation();
  const getViewSettings = useReaderStore((state) => state.getViewSettings);
  const getBookData = useBookDataStore((state) => state.getBookData);
  const progress = useBookProgress(bookKey);
  const settings = getViewSettings(bookKey);
  const bookData = getBookData(bookKey);
  const enabled =
    view !== null && bookData?.book?.format === 'PDF' && !!settings?.translationEnabled;
  const provider = settings?.translationProvider;
  const targetLanguage = settings?.translateTargetLang || getLocale();
  const metadataLanguage = bookData?.book?.primaryLanguage;
  const { translate } = useTranslator({
    provider,
    targetLang: targetLanguage,
  } as UseTranslatorOptions);
  const [pages, setPages] = useState<PDFPageTranslation[]>([]);
  const pagesRef = useRef<PDFPageTranslation[]>([]);
  const generationRef = useRef(0);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const refresh = useCallback(
    async (showEmptyToast: boolean) => {
      if (!enabled || !view) return;

      const generation = ++generationRef.current;
      const isCurrent = () => generationRef.current === generation;
      const sources = getVisiblePDFPageSources(view);

      if (sources.length === 0) {
        if (isCurrent()) setPages([]);
        if (showEmptyToast) {
          await eventDispatcher.dispatch('toast', {
            timeout: 5000,
            message: _(
              'No selectable text found for translation. This may be an image-based PDF or a scanned document.',
            ),
            type: 'info',
          });
        }
        return;
      }

      setPages(
        sources.map(({ index, text }) => ({
          index,
          sourceText: text,
          sourceLanguage: 'AUTO',
          status: 'detecting',
        })),
      );

      const resolved = await resolvePDFSourceLanguage({
        metadataLanguage,
        targetLanguage,
        sample: sources
          .map(({ text }) => text)
          .join('\n')
          .slice(0, 500),
      });
      if (!isCurrent()) return;

      if (resolved.skipTranslation) {
        setPages([]);
        await eventDispatcher.dispatch('toast', {
          timeout: 5000,
          message: _('The document is already in the target language. No translation needed.'),
          type: 'info',
        });
        return;
      }

      setPages(
        sources.map(({ index, text }) => ({
          index,
          sourceText: text,
          sourceLanguage: resolved.language,
          status: 'translating',
        })),
      );

      const settled = await Promise.allSettled(
        sources.map(({ text }) =>
          translate([text], { source: resolved.language, target: targetLanguage }),
        ),
      );
      if (!isCurrent()) return;

      setPages(
        sources.map(({ index, text }, resultIndex): PDFPageTranslation => {
          const result = settled[resultIndex]!;
          if (result.status === 'rejected') {
            return {
              index,
              sourceText: text,
              sourceLanguage: resolved.language,
              status: 'error',
              error: errorMessage(result.reason),
            };
          }

          const translatedText = result.value[0]?.trim();
          if (!translatedText) {
            return {
              index,
              sourceText: text,
              sourceLanguage: resolved.language,
              status: 'error',
              error: 'Translation returned an empty response.',
            };
          }

          return {
            index,
            sourceText: text,
            sourceLanguage: resolved.language,
            status: 'translated',
            translatedText,
          };
        }),
      );
    },
    [_, enabled, metadataLanguage, targetLanguage, translate, view],
  );

  useEffect(() => {
    if (!enabled || !view) {
      generationRef.current += 1;
      setPages([]);
      return;
    }

    const onLoad = () => void refresh(false);
    const onTextLayerRendered = () => void refresh(true);
    view.addEventListener('load', onLoad);
    view.addEventListener('pdf-text-layer-rendered', onTextLayerRendered);
    void refresh(false);

    return () => {
      view.removeEventListener('load', onLoad);
      view.removeEventListener('pdf-text-layer-rendered', onTextLayerRendered);
      generationRef.current += 1;
    };
  }, [enabled, progress?.index, refresh, view]);

  const retryPage = useCallback(
    (index: number) => {
      const page = pagesRef.current.find((candidate) => candidate.index === index);
      if (!page || !enabled) return;

      const generation = ++generationRef.current;
      setPages((current) =>
        current.map((candidate) =>
          candidate.index === index
            ? { ...candidate, status: 'translating', error: undefined }
            : candidate,
        ),
      );

      void translate([page.sourceText], {
        source: page.sourceLanguage,
        target: targetLanguage,
      })
        .then(([translatedText]) => {
          if (generationRef.current !== generation) return;
          setPages((current) =>
            current.map((candidate) => {
              if (candidate.index !== index || candidate.sourceText !== page.sourceText) {
                return candidate;
              }
              const translated = translatedText?.trim();
              return translated
                ? { ...candidate, status: 'translated', translatedText: translated }
                : {
                    ...candidate,
                    status: 'error',
                    error: 'Translation returned an empty response.',
                  };
            }),
          );
        })
        .catch((error: unknown) => {
          if (generationRef.current !== generation) return;
          setPages((current) =>
            current.map((candidate) =>
              candidate.index === index && candidate.sourceText === page.sourceText
                ? { ...candidate, status: 'error', error: errorMessage(error) }
                : candidate,
            ),
          );
        });
    },
    [enabled, targetLanguage, translate],
  );

  return { pages, retryPage };
}
```

- [ ] **Step 4: Run controller, language, and provider tests**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx src/__tests__/services/translators/pdfLanguage.test.ts src/__tests__/services/translators/providers/llm.test.ts
```

Expected: 3 test files pass with no failed tests.

- [ ] **Step 5: Commit the controller**

```bash
git add apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts apps/readest-app/src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx
git commit -m "feat: coordinate PDF page translations"
```

---

### Task 5: Render a responsive synchronized translation pane

**Files:**
- Create: `apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx`
- Create: `apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx`

**Interfaces:**
- Consumes: `PDFPageTranslation[]` and `retryPage(index)` from Task 4.
- Produces: accessible translated-page sections with progress, error, and retry states.

- [ ] **Step 1: Write pane rendering tests**

Create `PDFTranslationPane.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PDFTranslationPane from '@/app/reader/components/PDFTranslationPane';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));

describe('PDFTranslationPane', () => {
  it('renders translated spread pages in order', () => {
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 4,
            sourceText: 'Left',
            sourceLanguage: 'en',
            status: 'translated',
            translatedText: '左页',
          },
          {
            index: 5,
            sourceText: 'Right',
            sourceLanguage: 'en',
            status: 'translated',
            translatedText: '右页',
          },
        ]}
        onRetry={vi.fn()}
      />,
    );

    const sections = screen.getAllByRole('article');
    expect(sections[0]).toHaveTextContent('Page 5');
    expect(sections[0]).toHaveTextContent('左页');
    expect(sections[1]).toHaveTextContent('Page 6');
    expect(sections[1]).toHaveTextContent('右页');
  });

  it('shows an error and retries the failed page', () => {
    const onRetry = vi.fn();
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 2,
            sourceText: 'Source',
            sourceLanguage: 'AUTO',
            status: 'error',
            error: 'API offline',
          },
        ]}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('API offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith(2);
  });

  it('scrolls to the beginning when the visible page changes', () => {
    const page = (index: number, translatedText: string) => ({
      index,
      sourceText: `Source ${index}`,
      sourceLanguage: 'en',
      status: 'translated' as const,
      translatedText,
    });
    const { rerender } = render(
      <PDFTranslationPane pages={[page(0, '第一页')]} onRetry={vi.fn()} />,
    );
    const pane = screen.getByLabelText('PDF Translation');
    pane.scrollTop = 120;

    rerender(<PDFTranslationPane pages={[page(1, '第二页')]} onRetry={vi.fn()} />);

    expect(pane.scrollTop).toBe(0);
  });
});
```

- [ ] **Step 2: Run the pane tests and verify the component is missing**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx
```

Expected: FAIL because `PDFTranslationPane` does not exist.

- [ ] **Step 3: Implement the pane**

Create `PDFTranslationPane.tsx` with this public interface and rendering behavior:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PDFPageTranslation } from '../hooks/usePDFTranslation';

interface PDFTranslationPaneProps {
  pages: PDFPageTranslation[];
  onRetry: (index: number) => void;
}

const PDFTranslationPane = ({ pages, onRetry }: PDFTranslationPaneProps) => {
  const _ = useTranslation();
  const paneRef = useRef<HTMLElement>(null);
  const visiblePageKey = useMemo(
    () => pages.map((page) => `${page.index}:${page.sourceText}`).join('|'),
    [pages],
  );

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [visiblePageKey]);

  return (
    <aside
      ref={paneRef}
      aria-label={_('PDF Translation')}
      className='eink-bordered h-full min-h-0 min-w-0 overflow-y-auto border-base-300 bg-base-100 p-4 md:border-l max-md:border-t'
    >
      {pages.map((page) => (
        <article key={`${page.index}:${page.sourceText}`} className='mb-6 last:mb-0'>
          <h2 className='mb-2 text-sm font-semibold opacity-70'>
            {_('Page')} {page.index + 1}
          </h2>
          {(page.status === 'detecting' || page.status === 'translating') && (
            <div role='status' className='flex min-h-24 items-center justify-center'>
              <span aria-hidden='true' className='loading loading-spinner loading-md' />
              <span className='sr-only'>{_('Translating...')}</span>
            </div>
          )}
          {page.status === 'translated' && (
            <p className='whitespace-pre-wrap text-base leading-relaxed'>{page.translatedText}</p>
          )}
          {page.status === 'error' && (
            <div role='alert' className='rounded border border-error p-3'>
              <p>{page.error || _('Translation failed')}</p>
              <button
                type='button'
                className='btn btn-primary btn-sm mt-3'
                onClick={() => onRetry(page.index)}
              >
                {_('Retry')}
              </button>
            </div>
          )}
        </article>
      ))}
    </aside>
  );
};

export default PDFTranslationPane;
```

- [ ] **Step 4: Run pane tests**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/components/PDFTranslationPane.test.tsx
```

Expected: 1 test file passes.

- [ ] **Step 5: Commit the pane**

```bash
git add apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx apps/readest-app/src/__tests__/app/reader/components/PDFTranslationPane.test.tsx
git commit -m "feat: show synchronized PDF translations"
```

---

### Task 6: Integrate PDF translation into FoliateViewer and remove legacy iframe insertion

**Files:**
- Create: `apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx`
- Modify: `apps/readest-app/src/app/reader/components/FoliateViewer.tsx:1-170,657-692,978-1012`
- Modify: `apps/readest-app/src/app/reader/hooks/useTextTranslation.ts:289-332`
- Modify: `apps/readest-app/src/utils/walk.ts:27-30`
- Modify: `apps/readest-app/src/__tests__/app/reader/hooks/useTextTranslation.test.ts`

**Interfaces:**
- Consumes: `usePDFTranslation(bookKey, view)` and `PDFTranslationPane`.
- Produces: PDF-only responsive split layout; EPUB continues using `useTextTranslation`.

- [ ] **Step 1: Add the real extraction-to-pane regression**

Create `PDFTranslationFlow.test.tsx`. Mock only external state/provider boundaries; keep
`getVisiblePDFPageSources`, `usePDFTranslation`, and `PDFTranslationPane` real:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PDFTranslationPane from '@/app/reader/components/PDFTranslationPane';
import { usePDFTranslation } from '@/app/reader/hooks/usePDFTranslation';
import type { FoliateView } from '@/types/view';

const mocks = vi.hoisted(() => ({
  translate: vi.fn().mockResolvedValue(['PDF 译文']),
  progress: { index: 0 },
  settings: {
    translationEnabled: true,
    translationProvider: 'google',
    translateTargetLang: 'zh-CN',
  },
  bookData: { book: { format: 'PDF', primaryLanguage: 'en' } },
  translateUI: (text: string) => text,
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({ translate: mocks.translate }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => mocks.translateUI,
}));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => mocks.progress,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: unknown) => unknown) =>
    selector({ getViewSettings: () => mocks.settings }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (state: unknown) => unknown) =>
    selector({ getBookData: () => mocks.bookData }),
}));

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    left: 0,
    right: 600,
    width: 600,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: vi.fn(),
  }) as DOMRect;

const makeView = () => {
  const renderer = document.createElement('div');
  renderer.getBoundingClientRect = () => rect(0, 800);
  const iframe = document.createElement('iframe');
  iframe.getBoundingClientRect = () => rect(0, 800);
  renderer.appendChild(iframe);
  const pageDocument = iframe.contentDocument!;
  pageDocument.body.innerHTML =
    '<div class="textLayer"><span>Rendered PDF source</span></div>';
  Object.assign(renderer, {
    getContents: () => [{ doc: pageDocument, index: 0 }],
  });
  return {
    pageDocument,
    view: Object.assign(document.createElement('div'), { renderer }) as FoliateView,
  };
};

const Harness = ({ view }: { view: FoliateView }) => {
  const { pages, retryPage } = usePDFTranslation('book-1', view);
  return <PDFTranslationPane pages={pages} onRetry={retryPage} />;
};

describe('PDF translation flow', () => {
  it('renders extracted PDF text in the external pane without mutating the iframe', async () => {
    const { pageDocument, view } = makeView();
    render(<Harness view={view} />);

    await waitFor(() => expect(screen.getByText('PDF 译文')).toBeInTheDocument());
    expect(mocks.translate).toHaveBeenCalledWith(['Rendered PDF source'], {
      source: 'en',
      target: 'zh-CN',
    });
    expect(pageDocument.querySelector('.translation-target')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the flow regression before viewer integration**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run src/__tests__/app/reader/PDFTranslationFlow.test.tsx
```

Expected: PASS after Tasks 2-5. This locks the principal text-layer extraction → controller →
external pane path before changing `FoliateViewer` layout.

- [ ] **Step 3: Add a regression assertion that EPUB target-node behavior remains intact**

Keep every existing `createTranslationTargetNode` test and add:

```typescript
it('does not create PDF-specific inline layout styles', () => {
  const wrapper = createTranslationTargetNode({
    translatedText: 'Translation',
    lang: 'en',
    targetBlockClassName: 'translation-target-block',
    hidden: false,
    widthLineBreak: false,
  });

  expect(wrapper.style.position).toBe('');
  expect(wrapper.style.width).toBe('');
});
```

- [ ] **Step 4: Remove legacy PDF DOM mutation**

Delete the complete `if (el.classList.contains('textLayer'))` branch from
`useTextTranslation.translateElement`. Do not change the following EPUB `updateSourceNodes` branch.

Delete this PDF-specific block from `walkTextNodes`:

```typescript
if (child.classList.contains('textLayer') && child.textContent?.trim()) {
  elements.push(child);
  continue;
}
```

- [ ] **Step 5: Give FoliateViewer a reactive view value**

Alongside `viewRef`, add:

```typescript
const [mountedView, setMountedView] = useState<FoliateView | null>(null);
```

Immediately after `viewRef.current = view`, add:

```typescript
setMountedView(view);
```

This state removes the existing ref-mutation race and gives both translation hooks a reliable
effect dependency.

- [ ] **Step 6: Route EPUB and PDF through separate controllers**

Add imports:

```typescript
import { usePDFTranslation } from '../hooks/usePDFTranslation';
import PDFTranslationPane from './PDFTranslationPane';
```

Replace the current body-translation hook call with:

```typescript
const isPDF = bookData?.book?.format === 'PDF';
useTextTranslation(bookKey, isPDF ? null : mountedView);
const pdfTranslation = usePDFTranslation(bookKey, isPDF ? mountedView : null);
const showPDFTranslation =
  isPDF && !!viewSettings?.translationEnabled && pdfTranslation.pages.length > 0;
```

- [ ] **Step 7: Render the responsive PDF/translation split**

Replace the self-closing `containerRef` div with this wrapper and inner viewer container:

```tsx
<div
  className={clsx(
    'absolute h-full w-full min-h-0 min-w-0',
    showPDFTranslation && 'flex flex-col md:flex-row',
  )}
>
  <div
    ref={containerRef}
    role='main'
    aria-label={_('Book Content')}
    className={clsx(
      'foliate-viewer min-h-0 min-w-0 flex-1 focus:outline-none',
      viewState?.loading && 'bg-base-100',
      showPDFTranslation && 'basis-1/2',
    )}
    style={{
      paddingTop: scrollMargins.top,
      paddingBottom: scrollMargins.bottom,
    }}
    {...mouseHandlers}
    {...touchHandlers}
  />
  {showPDFTranslation && (
    <div className='min-h-0 min-w-0 flex-1 basis-1/2'>
      <PDFTranslationPane pages={pdfTranslation.pages} onRetry={pdfTranslation.retryPage} />
    </div>
  )}
</div>
```

Keep overlays and reader controls as siblings after this wrapper, matching their current z-index
behavior.

- [ ] **Step 8: Run the focused end-to-end regression set**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run \
  src/__tests__/services/translators/providers/llm.test.ts \
  src/__tests__/hooks/useTranslator.test.tsx \
  src/__tests__/services/translators/pdfLanguage.test.ts \
  src/__tests__/app/reader/utils/pdfTranslation.test.ts \
  src/__tests__/app/reader/hooks/usePDFTranslation.test.tsx \
  src/__tests__/app/reader/components/PDFTranslationPane.test.tsx \
  src/__tests__/app/reader/PDFTranslationFlow.test.tsx \
  src/__tests__/app/reader/hooks/useTextTranslation.test.ts
```

Expected: 8 test files pass. The PDF integration assertion confirms translated content is supplied
to the pane and the iframe document has no `.translation-target` mutation.

- [ ] **Step 9: Run type checking and formatting checks**

Run:

```bash
pnpm --dir apps/readest-app exec tsgo --noEmit
pnpm --dir apps/readest-app exec biome check \
  src/services/translators/providers/llm.ts \
  src/services/translators/pdfLanguage.ts \
  src/app/reader/utils/pdfTranslation.ts \
  src/app/reader/hooks/usePDFTranslation.ts \
  src/app/reader/hooks/useTextTranslation.ts \
  src/app/reader/components/PDFTranslationPane.tsx \
  src/app/reader/components/FoliateViewer.tsx \
  src/__tests__/app/reader/PDFTranslationFlow.test.tsx \
  src/utils/walk.ts
git diff --check
```

Expected: all commands exit 0 and Biome reports no fixes required.

- [ ] **Step 10: Commit viewer integration and legacy cleanup**

```bash
git add \
  apps/readest-app/src/app/reader/components/FoliateViewer.tsx \
  apps/readest-app/src/app/reader/components/PDFTranslationPane.tsx \
  apps/readest-app/src/app/reader/hooks/usePDFTranslation.ts \
  apps/readest-app/src/app/reader/hooks/useTextTranslation.ts \
  apps/readest-app/src/utils/walk.ts \
  apps/readest-app/src/__tests__/app/reader/PDFTranslationFlow.test.tsx \
  apps/readest-app/src/__tests__/app/reader/hooks/useTextTranslation.test.ts
git commit -m "fix: display PDF translations beside source pages"
```

---

### Task 7: Final verification and design traceability

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-pdf-translation-reliability-design.md`
- Modify: `docs/superpowers/plans/2026-07-14-pdf-translation-reliability.md`

**Interfaces:**
- Consumes: all implementation and regression tests from Tasks 1-6.
- Produces: verified final branch state and documentation that records actual validation evidence.

- [ ] **Step 1: Run the complete app unit suite**

Run:

```bash
pnpm --dir apps/readest-app exec vitest run
```

Expected: all unit tests pass. If the known Node `--localstorage-file` environment issue recurs,
capture the exact output, rerun the eight focused files from Task 6 directly with `pnpm exec vitest
run`, and report the full-suite environment failure separately rather than calling the full suite
green.

- [ ] **Step 2: Run app lint and production type checks**

Run:

```bash
pnpm --dir apps/readest-app lint
pnpm --dir apps/readest-app format:check
git diff --check
```

Expected: all commands exit 0. Record pre-existing unrelated failures verbatim and do not suppress
them with source changes outside this plan.

- [ ] **Step 3: Perform a real PDF smoke test**

Run the web app:

```bash
pnpm --dir apps/readest-app dev-web
```

Using a text-based PDF, verify this checklist in the browser:

```text
[ ] Original PDF remains visible while translation is enabled.
[ ] Wide viewport shows PDF and translation pane side by side.
[ ] Narrow viewport shows PDF above the translation pane.
[ ] Page turns update the pane to the visible page/spread.
[ ] Two-page spread translations appear in reading order.
[ ] Unknown-language PDF continues with Google when Ollama is unavailable.
[ ] Failed LLM request shows an error and Retry instead of source text.
[ ] Zoom, selection, annotations, and translation disable/enable still work.
```

- [ ] **Step 4: Record implementation status and evidence**

In the design document, change `**Status:** Approved for planning` to `**Status:** Implemented` only
after Steps 1-3 have evidence. Add a `## Validation` section containing the exact commands run and
their results. In this plan, check completed boxes only for steps actually executed.

- [ ] **Step 5: Review the complete diff for all three original defects**

Run:

```bash
git diff origin/main...HEAD -- \
  apps/readest-app/src/services/translators \
  apps/readest-app/src/app/reader \
  apps/readest-app/src/utils/walk.ts \
  packages/foliate-js/pdf.js \
  docs/superpowers
```

Confirm the diff contains no PDF iframe translation-node append, no provider catch that returns
source text on failure, and no `detected === 'und'` branch that aborts PDF translation.

- [ ] **Step 6: Commit validation documentation**

```bash
git add \
  docs/superpowers/specs/2026-07-14-pdf-translation-reliability-design.md \
  docs/superpowers/plans/2026-07-14-pdf-translation-reliability.md
git commit -m "docs: record PDF translation verification"
```
