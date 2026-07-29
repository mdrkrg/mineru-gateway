import { type } from 'arktype';

export const MineruBackendSchema = type(
  "'pipeline' | 'vlm-engine' | 'hybrid-engine' | 'vlm-http-client' | 'hybrid-http-client'",
);
export type MineruBackend = typeof MineruBackendSchema.infer;

export const MineruLanguageSchema = type(
  "'ch' | 'ch_server' | 'korean' | 'ta' | 'te' | 'ka' | 'th' | 'el' | 'arabic' | 'east_slavic' | 'cyrillic' | 'devanagari'",
);
export type MineruLanguage = typeof MineruLanguageSchema.infer;

export const MineruEffortSchema = type("'medium' | 'high'");
export type MineruEffort = typeof MineruEffortSchema.infer;

export const MineruParseMethodSchema = type("'auto' | 'txt' | 'ocr'");
export type MineruParseMethod = typeof MineruParseMethodSchema.infer;

export const MINERU_BACKENDS: MineruBackend[] = [
  'pipeline',
  'vlm-engine',
  'hybrid-engine',
  'vlm-http-client',
  'hybrid-http-client',
];
export const MINERU_LANGUAGES: MineruLanguage[] = [
  'ch',
  'ch_server',
  'korean',
  'ta',
  'te',
  'ka',
  'th',
  'el',
  'arabic',
  'east_slavic',
  'cyrillic',
  'devanagari',
];
export const MINERU_EFFORTS: MineruEffort[] = ['medium', 'high'];
export const MINERU_PARSE_METHODS: MineruParseMethod[] = ['auto', 'txt', 'ocr'];
