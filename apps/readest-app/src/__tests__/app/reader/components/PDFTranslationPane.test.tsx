import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PDFTranslationPane from '@/app/reader/components/PDFTranslationPane';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));

afterEach(cleanup);

describe('PDFTranslationPane', () => {
  it('renders translated spread pages in order', () => {
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 4,
            sourceParagraphs: ['Left'],
            sourceLanguage: 'en',
            status: 'translated',
            translatedParagraphs: ['左页'],
          },
          {
            index: 5,
            sourceParagraphs: ['Right'],
            sourceLanguage: 'en',
            status: 'translated',
            translatedParagraphs: ['右页'],
          },
        ]}
        onRetry={vi.fn()}
      />,
    );

    const sections = screen.getAllByRole('article');
    expect(sections[0]?.textContent).toContain('Page 5');
    expect(sections[0]?.textContent).toContain('左页');
    expect(sections[1]?.textContent).toContain('Page 6');
    expect(sections[1]?.textContent).toContain('右页');
  });

  it('renders each translated body paragraph separately', () => {
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 0,
            sourceParagraphs: ['First paragraph.', 'Second paragraph.'],
            sourceLanguage: 'en',
            status: 'translated',
            translatedParagraphs: ['第一段。', '第二段。'],
          },
        ]}
        onRetry={vi.fn()}
      />,
    );

    const paragraphs = screen.getAllByText(/第一段。|第二段。/);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.map((paragraph) => paragraph.tagName)).toEqual(['P', 'P']);
  });

  it('shows an error and retries the failed page', () => {
    const onRetry = vi.fn();
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 2,
            sourceParagraphs: ['Source'],
            sourceLanguage: 'AUTO',
            status: 'error',
            error: 'API offline',
          },
        ]}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('API offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith(2);
  });

  it('exposes pending translation state to assistive technology', () => {
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 2,
            sourceParagraphs: ['Source'],
            sourceLanguage: 'AUTO',
            status: 'translating',
          },
        ]}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Translating...');
  });

  it('scrolls to the beginning when the visible page changes', () => {
    const page = (index: number, translatedParagraphs: string[]) => ({
      index,
      sourceParagraphs: [`Source ${index}`],
      sourceLanguage: 'en',
      status: 'translated' as const,
      translatedParagraphs,
    });
    const { rerender } = render(
      <PDFTranslationPane pages={[page(0, ['第一页'])]} onRetry={vi.fn()} />,
    );
    const pane = screen.getByLabelText('PDF Translation');
    pane.scrollTop = 120;

    rerender(<PDFTranslationPane pages={[page(1, ['第二页'])]} onRetry={vi.fn()} />);

    expect(pane.scrollTop).toBe(0);
  });
});
