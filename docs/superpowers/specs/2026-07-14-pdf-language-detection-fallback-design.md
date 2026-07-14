# PDF Language Detection Fallback Design

**Date:** 2026-07-14
**Status:** Approved for planning

## Context

PDF files frequently omit `dc:language`. The current translation flow handles that case by calling
the configured LLM for language detection before scheduling any text translation. If detection
returns `und`, including when the local Ollama service is unavailable, the flow stops. This makes
language detection a hard dependency even when the selected translation provider is Google.

## Decision

Language detection is best effort. Missing AI configuration, provider errors, invalid responses,
and timeouts must not prevent PDF body translation.

When detection cannot produce a trustworthy language, the source language remains `AUTO`. The
system does not assume English for control-flow decisions. In particular, an unverified English
fallback must never be used to conclude that an unknown-language PDF is already in an English
target language.

## Goals

- Use PDF language metadata when it is present and valid.
- For PDFs without valid language metadata, try the currently configured LLM provider.
- Skip translation only when a successfully detected language matches the target language.
- Continue translation with source language `AUTO` when detection is unavailable or fails.
- Keep Google translation independent from AI/LLM availability.
- Make the behavior deterministic and covered by focused tests.

## Non-goals

- Adding another language-detection provider.
- Changing the user's AI provider or translation provider settings.
- Persisting detected language into book metadata.
- Treating English as the implicit language of all PDFs.
- Redesigning PDF translated-text layout; that is a separate defect and fix.
- Changing general EPUB language handling.

## Language Resolution

The flow resolves a source-language result with both a language and its provenance:

| Situation | Resolved language | Provenance | May skip as same language? |
| --- | --- | --- | --- |
| Valid PDF metadata | Metadata language | `metadata` | Yes |
| Successful LLM detection | Detected ISO language | `detected` | Yes |
| LLM not configured | `AUTO` | `fallback` | No |
| Detection request fails | `AUTO` | `fallback` | No |
| Detection response is invalid or `und` | `AUTO` | `fallback` | No |

`AUTO` represents an unknown source language, not English. Both current translation providers can
handle it: Google sends `sl=auto`, while the LLM prompt asks the model to infer the source language.

## Data Flow

1. Read the book's primary language.
2. If it is present and not `und`, use it as a trusted metadata result.
3. Otherwise inspect the current AI settings:
   - If no usable LLM configuration exists, resolve to `AUTO` immediately.
   - If an LLM is configured, attempt language detection with that provider.
4. Normalize and validate the detection response as an ISO language code.
5. If the trusted metadata or detected language matches the target language, show the existing
   “already in target language” message and stop.
6. For every fallback result, continue scheduling PDF text nodes for translation with source
   language `AUTO`.
7. Detection failure may be logged for diagnostics, but it must not show the existing
   “translation is not available” message because translation remains available.

## Error Handling

- Configuration absence is an expected fallback condition, not an error.
- Network errors, unavailable Ollama, timeouts, and malformed model responses resolve to `AUTO`.
- Detection errors must not be confused with body-translation errors.
- The loading indicator must be cleared after every detection outcome.
- A stale detection result must not schedule work after translation has been disabled or the view
  has been replaced.

## Implementation Boundaries

- Keep language resolution separate from DOM observation so it can be tested without rendering the
  reader.
- `useTextTranslation` consumes the resolved result and decides whether to skip or schedule nodes.
- The resolved source language must be passed into the translation call when available; fallback
  calls use `AUTO`.
- Do not add new user settings or dependencies.

## Tests

Focused tests must cover:

1. A valid metadata language bypasses LLM detection.
2. A successful detection different from the target schedules translation.
3. A successful detection equal to the target skips translation.
4. Missing LLM configuration resolves to `AUTO` and still schedules translation.
5. An unavailable Ollama service resolves to `AUTO` and still schedules translation.
6. An invalid or `und` model response resolves to `AUTO` and still schedules translation.
7. A fallback result with an English target does not skip a non-English/unknown PDF.
8. Disabling translation or replacing the view while detection is pending does not schedule stale
   nodes.

The regression test should assert that body translation is invoked, rather than merely asserting
that language detection returned a value.

## Success Criteria

- An unknown-language PDF can be translated with Google when no LLM is configured or reachable.
- An unknown-language PDF can be translated with the configured LLM when detection fails.
- Only trusted metadata or a successful detection can trigger the same-language early exit.
- Detection failures no longer produce a misleading “translation is not available” outcome.
