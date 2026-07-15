import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PDFTranslationPane from '@/app/reader/components/PDFTranslationPane';
import type { PDFPageTranslation } from '@/app/reader/hooks/usePDFTranslation';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));

afterEach(cleanup);

describe('PDFTranslationPane', () => {
  const translatedPage = (index: number, translatedMarkdown: string): PDFPageTranslation => ({
    index,
    sourceBlocks: [{ kind: 'paragraph', text: `Source ${index}` }],
    sourceLanguage: 'en',
    status: 'translated',
    translatedMarkdown,
  });

  it('renders translated spread pages in order', () => {
    render(
      <PDFTranslationPane
        pages={[translatedPage(4, '左页'), translatedPage(5, '右页')]}
        onRetry={vi.fn()}
      />,
    );

    const sections = screen.getAllByRole('article');
    expect(sections[0]?.textContent).toContain('Page 5');
    expect(sections[0]?.textContent).toContain('左页');
    expect(sections[1]?.textContent).toContain('Page 6');
    expect(sections[1]?.textContent).toContain('右页');
  });

  it('renders translated markdown blocks', () => {
    render(
      <PDFTranslationPane
        pages={[translatedPage(0, '# 标题\n\n- 项目\n\n> 引文\n\n正文')]}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: '标题' })).not.toBeNull();
    expect(screen.getByRole('listitem').textContent).toBe('项目');
    expect(screen.getByText('引文').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('正文').tagName).toBe('P');
  });

  it('does not render raw HTML from translated markdown', () => {
    render(
      <PDFTranslationPane
        pages={[translatedPage(0, '<img src=x onerror=alert(1)>')]}
        onRetry={vi.fn()}
      />,
    );

    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an error and retries the failed page', () => {
    const onRetry = vi.fn();
    render(
      <PDFTranslationPane
        pages={[
          {
            index: 2,
            sourceBlocks: [{ kind: 'paragraph', text: 'Source' }],
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
            sourceBlocks: [{ kind: 'paragraph', text: 'Source' }],
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
    const { rerender } = render(
      <PDFTranslationPane pages={[translatedPage(0, '第一页')]} onRetry={vi.fn()} />,
    );
    const pane = screen.getByLabelText('PDF Translation');
    pane.scrollTop = 120;

    rerender(<PDFTranslationPane pages={[translatedPage(1, '第二页')]} onRetry={vi.fn()} />);

    expect(pane.scrollTop).toBe(0);
  });
});
