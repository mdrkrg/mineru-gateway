import { describe, expect, it } from 'vitest';
import {
  MINERU_DEFAULT_OUTPUT_FORMATS,
  MINERU_OUTPUT_FORMATS,
  createParseFormData,
} from '../../src/api/schemas/mineru-options';

describe('mineru output formats', () => {
  it('defaults to formats the picker offers', () => {
    for (const format of MINERU_DEFAULT_OUTPUT_FORMATS) {
      expect(MINERU_OUTPUT_FORMATS).toContain(format);
    }
  });

  it('serialises the selection as one comma-separated field', () => {
    const fd = createParseFormData({
      files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
      outputFormats: ['markdown', 'structured_content', 'zip'],
    });

    expect(fd.getAll('files')).toHaveLength(1);
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
