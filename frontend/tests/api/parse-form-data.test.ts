import { describe, expect, it } from 'vitest';
import { createParseFormData } from '../../src/api/schemas/mineru-options';

describe('createParseFormData', () => {
  it('serialises the selection as one comma-separated field', () => {
    const fd = createParseFormData({
      files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
      outputFormats: ['markdown', 'structured_content', 'zip'],
    });

    expect(fd.get('output_formats')).toBe('markdown,structured_content,zip');
  });

  it('omits output_formats when nothing is selected', () => {
    const fd = createParseFormData({
      files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
      outputFormats: [],
    });

    expect(fd.has('output_formats')).toBe(false);
  });
});
