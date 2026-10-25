import * as stylex from '@stylexjs/stylex';
import { For, Show, createSignal } from 'solid-js';
import { Link, createFileRoute } from '@tanstack/solid-router';
import { FileUp, CircleQuestionMark, X } from 'lucide-solid';
import { submitTask } from '@/api/functions/tasks';
import type { TaskSubmitResponse } from '@/api/schemas/tasks';
import {
  MINERU_EFFORTS,
  MINERU_LANGUAGES,
  MINERU_PARSE_METHODS,
  MINERU_SERVER_BACKENDS,
  type ServerOnlyMineruBackend,
  type MineruEffort,
  type MineruLanguage,
  type MineruParseMethod,
} from '@/api/schemas/mineru-options';
import NoActiveKey from '@/components/NoActiveKey';
import { t } from '@/i18n';
import { mineruBackendLabel, mineruLanguageCoverage, mineruLanguageLabel } from '@/i18n/labels';
import { useApiKey } from '@/stores/api-key-context';
import { useToast } from '@/stores/toast-context';
import { errorMessage } from '@/utils/api-error';
import { ROUTES } from '@/utils/constants';
import { formatFileSize } from '@/utils/format';
import { newIdempotencyKey } from '@/utils/idempotency';
import { validateUploadSize } from '@/utils/upload';
import { env } from '@/env';
import { controls } from '@/styles/controls.stylex';
import { feedback } from '@/styles/feedback.stylex';
import { forms } from '@/styles/forms.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { breakpoint, colors, radius, shadow, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export const Route = createFileRoute('/_authenticated/upload')({
  component: UploadPage,
});

const styles = stylex.create({
  dropzone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: radius.px8,
    padding: space.px32,
    cursor: 'pointer',
  },
  dropzoneIdle: {
    borderColor: {
      default: colors.gray300,
      ':hover': colors.blue400,
    },
  },
  dropzoneDragging: {
    borderColor: colors.blue500,
    backgroundColor: colors.blue50,
  },
  fileIcon: {
    color: colors.gray400,
    marginBottom: space.px8,
  },
  hidden: {
    display: 'none',
  },
  fileList: {
    marginTop: space.px12,
    display: 'flex',
    flexDirection: 'column',
    gap: space.px4,
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.gray50,
    borderRadius: radius.px4,
    paddingInline: space.px12,
    paddingBlock: space.px6,
  },
  fileSize: {
    color: colors.gray400,
    marginLeft: space.px8,
  },
  removeButton: {
    ':hover': {
      color: colors.red600,
    },
  },
  optionsGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'repeat(1, minmax(0, 1fr))',
      [breakpoint.sm]: 'repeat(3, minmax(0, 1fr))',
    },
    gap: space.px16,
  },
  languageHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: space.px6,
    marginBottom: space.px8,
  },
  tooltipHost: {
    position: 'relative',
    display: 'inline-flex',
    cursor: 'help',
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    translate: '-50% 0',
    marginBottom: space.px8,
    zIndex: 10,
    display: {
      default: 'none',
      [stylex.when.ancestor(':hover')]: 'block',
    },
  },
  languageList: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: space.px16,
    rowGap: space.px6,
  },
  optionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: space.px24,
    rowGap: space.px6,
  },
  submit: {
    alignSelf: 'flex-start',
    paddingInline: space.px24,
  },
  codeTable: {
    backgroundColor: colors.gray900,
    color: colors.white,
    borderRadius: radius.px8,
    boxShadow: shadow.lg,
    padding: space.px12,
    width: space.px320,
  },
  codeTableTh: {
    textAlign: 'left',
    paddingInlineEnd: space.px8,
    paddingBlock: space.px2,
  },
  codeTableThLast: {
    textAlign: 'left',
    paddingBlock: space.px2,
  },
  codeTableTd: {
    paddingInlineEnd: space.px8,
    paddingBlock: space.px2,
    whiteSpace: 'nowrap',
    verticalAlign: 'top',
  },
  codeTableTdLast: {
    paddingBlock: space.px2,
  },
});

function LanguageCodeTable() {
  return (
    <div {...stylex.attrs(typography.meta, styles.codeTable)}>
      <table {...stylex.attrs(layout.fullWidth)}>
        <thead>
          <tr {...stylex.attrs(typography.faint)}>
            <th {...stylex.attrs(styles.codeTableTh)}>{t('upload.langTableOption')}</th>
            <th {...stylex.attrs(styles.codeTableThLast)}>{t('upload.langTableCoverage')}</th>
          </tr>
        </thead>
        <tbody>
          {MINERU_LANGUAGES.map((lang) => (
            <tr>
              <td {...stylex.attrs(styles.codeTableTd)}>{mineruLanguageLabel(lang)}</td>
              <td {...stylex.attrs(styles.codeTableTdLast)}>{mineruLanguageCoverage(lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UploadPage() {
  const apiKeyStore = useApiKey();
  const toast = useToast();

  const [files, setFiles] = createSignal<File[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [backend, setBackend] = createSignal<ServerOnlyMineruBackend>('hybrid-engine');
  const [langList, setLangList] = createSignal<Set<MineruLanguage>>(new Set(['ch']));
  const [effort, setEffort] = createSignal<MineruEffort>('medium');
  const [parseMethod, setParseMethod] = createSignal<MineruParseMethod>('auto');
  const [formulaEnable, setFormulaEnable] = createSignal(true);
  const [tableEnable, setTableEnable] = createSignal(true);
  const [imageAnalysis, setImageAnalysis] = createSignal(false);
  const [responseZip, setResponseZip] = createSignal(true);

  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [submitted, setSubmitted] = createSignal<TaskSubmitResponse | null>(null);
  // One idempotency key per form payload: a retry after a failed submit
  // reuses it, while any input change starts a new submission.
  let submissionKey: string | null = null;

  function resetSubmissionKey() {
    submissionKey = null;
  }

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;

    const next = [...files(), ...incoming];
    const check = validateUploadSize(next, env.maxUploadSizeBytes);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    setError(null);
    setFiles(next);
    resetSubmissionKey();
  }

  // dragenter/dragleave fire on child elements too, so track nesting depth to
  // avoid flickering the highlight while dragging over the drop zone.
  let dragDepth = 0;

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragDepth += 1;
    setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setIsDragging(false);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    setIsDragging(false);
    addFiles(e.dataTransfer?.files ?? null);
  }

  const totalSize = () => files().reduce((sum, file) => sum + file.size, 0);

  function removeFile(index: number) {
    setFiles(files().filter((_, i) => i !== index));
    resetSubmissionKey();
  }

  // Any option that contributes to the multipart body invalidates the key.
  function updateOption<T>(setter: (value: T) => void, value: T) {
    resetSubmissionKey();
    setter(value);
  }

  function toggleLang(lang: MineruLanguage, checked: boolean) {
    const next = new Set(langList());
    if (checked) next.add(lang);
    else next.delete(lang);
    resetSubmissionKey();
    setLangList(next);
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const key = apiKeyStore.activeKey();
    if (!key) return;
    if (files().length === 0) {
      setError(t('upload.errNoFile'));
      return;
    }
    const sizeCheck = validateUploadSize(files(), env.maxUploadSizeBytes);
    if (!sizeCheck.ok) {
      setError(sizeCheck.message);
      return;
    }

    // Generate before flipping isSubmitting: a throwing key generator must
    // not leave the submit button disabled forever. The error path keeps the
    // key so a retry of the same payload is idempotent.
    const idempotencyKey = (submissionKey ??= newIdempotencyKey());

    setIsSubmitting(true);
    setError(null);
    setSubmitted(null);

    try {
      const result = await submitTask({
        apiKey: key,
        idempotencyKey,
        parseFields: {
          files: files(),
          backend: backend(),
          langList: [...langList()],
          effort: effort(),
          parseMethod: parseMethod(),
          formulaEnable: formulaEnable(),
          tableEnable: tableEnable(),
          imageAnalysis: imageAnalysis(),
          returnImages: true,
          responseFormat: responseZip() ? 'zip' : 'json',
        },
      });

      if (result.isErr()) {
        setError(errorMessage(result.error));
        return;
      }
      setSubmitted(result.value);
      setFiles([]);
      resetSubmissionKey();
      toast.show(t('upload.submitted'), 'success');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div {...stylex.attrs(layout.stack16, layout.pageWidth768)}>
      <Show when={!apiKeyStore.activeKey()}>
        <NoActiveKey />
      </Show>

      <Show when={apiKeyStore.activeKey()}>
        <Show when={submitted()}>
          {(s) => (
            <div {...stylex.attrs(feedback.successBox)}>
              <h3 {...stylex.attrs(feedback.successTitle)}>{t('upload.submitted')}</h3>
              <p {...stylex.attrs(feedback.successText, layout.mb8)}>
                {t('upload.taskIdLabel')}
                <code>{s().taskId}</code>
                {t('upload.fileCount', { count: s().fileNames.length })}
              </p>
              <Link
                to={ROUTES.taskDetail(s().taskId)}
                class={stylex.attrs(controls.link, typography.body).class}
              >
                {t('upload.viewDetail')}
              </Link>
            </div>
          )}
        </Show>

        <Show when={error()}>
          <p {...stylex.attrs(controls.alert, controls.alertError)}>{error()}</p>
        </Show>

        <form onSubmit={handleSubmit} {...stylex.attrs(layout.stack16)}>
          {/* File picker */}
          <section {...stylex.attrs(controls.card, layout.column)}>
            <h2 {...stylex.attrs(typography.sectionHeading, layout.mb12)}>
              {t('upload.fileSection')}
            </h2>
            <label
              {...stylex.attrs(
                layout.transitionColors,
                styles.dropzone,
                isDragging() ? styles.dropzoneDragging : styles.dropzoneIdle,
              )}
              onDragEnter={handleDragEnter}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <FileUp class={stylex.attrs(icons.lg, styles.fileIcon).class} />
              <span {...stylex.attrs(typography.bodyMuted)}>{t('upload.filePicker')}</span>
              <input
                type="file"
                multiple
                {...stylex.attrs(styles.hidden)}
                onChange={(e) => {
                  // Reset so re-picking the same file (e.g. after a rejected
                  // selection or a successful submit) fires change again.
                  addFiles(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <Show when={files().length > 0}>
              <ul {...stylex.attrs(styles.fileList)}>
                <For each={files()}>
                  {(file, index) => (
                    <li {...stylex.attrs(typography.body, styles.fileItem)}>
                      <span>
                        {file.name}
                        <span {...stylex.attrs(styles.fileSize)}>
                          {formatFileSize(file.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index())}
                        {...stylex.attrs(controls.iconButton, styles.removeButton)}
                      >
                        <X class={stylex.attrs(icons.sm).class} />
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <p {...stylex.attrs(typography.metaFaint, layout.mt8)}>
                {t('upload.sizeSummary', {
                  count: files().length,
                  size: formatFileSize(totalSize()),
                  limit: formatFileSize(env.maxUploadSizeBytes),
                })}
              </p>
            </Show>
          </section>

          {/* Parse options */}
          <section {...stylex.attrs(controls.card, layout.stack16)}>
            <h2 {...stylex.attrs(typography.sectionHeading)}>
              {t('upload.optionsSection')}
            </h2>

            <div {...stylex.attrs(styles.optionsGrid)}>
              <label {...stylex.attrs(controls.field)}>
                <span {...stylex.attrs(controls.fieldLabel)}>{t('upload.backend')}</span>
                <select
                  value={backend()}
                  onChange={(e) =>
                    updateOption(
                      setBackend,
                      e.currentTarget.value as ServerOnlyMineruBackend,
                    )
                  }
                  {...stylex.attrs(controls.input)}
                >
                  <For each={MINERU_SERVER_BACKENDS}>
                    {(b) => <option value={b}>{mineruBackendLabel(b)}</option>}
                  </For>
                </select>
              </label>
              <label {...stylex.attrs(controls.field)}>
                <span {...stylex.attrs(controls.fieldLabel)}>{t('upload.parseMethod')}</span>
                <select
                  value={parseMethod()}
                  onChange={(e) =>
                    updateOption(
                      setParseMethod,
                      e.currentTarget.value as MineruParseMethod,
                    )
                  }
                  {...stylex.attrs(controls.input)}
                >
                  <For each={MINERU_PARSE_METHODS}>
                    {(m) => <option value={m}>{m}</option>}
                  </For>
                </select>
              </label>
              <label {...stylex.attrs(controls.field)}>
                <span {...stylex.attrs(controls.fieldLabel)}>{t('upload.effort')}</span>
                <select
                  value={effort()}
                  onChange={(e) =>
                    updateOption(setEffort, e.currentTarget.value as MineruEffort)
                  }
                  {...stylex.attrs(controls.input)}
                >
                  <For each={MINERU_EFFORTS}>
                    {(ef) => <option value={ef}>{ef}</option>}
                  </For>
                </select>
              </label>
            </div>

            <div>
              <div {...stylex.attrs(controls.fieldLabel, styles.languageHeader)}>
                {t('upload.language')}
                <div {...stylex.attrs(styles.tooltipHost, stylex.defaultMarker())}>
                  <CircleQuestionMark class={stylex.attrs(icons.sm, typography.faint).class} />
                  <div {...stylex.attrs(styles.tooltip)}>
                    <LanguageCodeTable />
                  </div>
                </div>
              </div>
              <div {...stylex.attrs(styles.languageList)}>
                <For each={MINERU_LANGUAGES}>
                  {(lang) => (
                    <label {...stylex.attrs(forms.checkboxLabel)}>
                      <input
                        type="checkbox"
                        checked={langList().has(lang)}
                        onChange={(e) => toggleLang(lang, e.currentTarget.checked)}
                      />
                      {mineruLanguageLabel(lang)}
                    </label>
                  )}
                </For>
              </div>
            </div>

            <div {...stylex.attrs(styles.optionsRow)}>
              <label {...stylex.attrs(forms.checkboxLabel)}>
                <input
                  type="checkbox"
                  checked={formulaEnable()}
                  onChange={(e) => updateOption(setFormulaEnable, e.currentTarget.checked)}
                />
                {t('upload.formula')}
              </label>
              <label {...stylex.attrs(forms.checkboxLabel)}>
                <input
                  type="checkbox"
                  checked={tableEnable()}
                  onChange={(e) => updateOption(setTableEnable, e.currentTarget.checked)}
                />
                {t('upload.table')}
              </label>
              <label {...stylex.attrs(forms.checkboxLabel)}>
                <input
                  type="checkbox"
                  checked={imageAnalysis()}
                  onChange={(e) => updateOption(setImageAnalysis, e.currentTarget.checked)}
                />
                {t('upload.imageAnalysis')}
              </label>
              <label {...stylex.attrs(forms.checkboxLabel)}>
                <input
                  type="checkbox"
                  checked={responseZip()}
                  onChange={(e) => updateOption(setResponseZip, e.currentTarget.checked)}
                />
                {t('upload.zipDownload')}
              </label>
            </div>
          </section>

          <button
            type="submit"
            disabled={isSubmitting() || files().length === 0}
            {...stylex.attrs(controls.button, controls.buttonPrimary, controls.buttonLarge, styles.submit)}
          >
            {isSubmitting()
              ? t('upload.submitting')
              : t('upload.submit', { count: files().length })}
          </button>
        </form>
      </Show>
    </div>
  );
}
