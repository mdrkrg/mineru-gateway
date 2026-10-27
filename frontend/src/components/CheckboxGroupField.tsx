import * as stylex from '@stylexjs/stylex';
import { For, Show, createUniqueId } from 'solid-js';
import { Info } from 'lucide-solid';
import { controls } from '@/styles/controls.stylex';
import { forms } from '@/styles/forms.stylex';
import { icons } from '@/styles/icons.stylex';
import { layout } from '@/styles/layout.stylex';
import { colors, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

export interface CheckboxFieldOption<T extends string> {
  value: T;
  label: string;
  /** Native tooltip with a longer explanation of the option. */
  description?: string;
}

interface CheckboxGroupFieldProps<T extends string> {
  label: string;
  options: readonly CheckboxFieldOption<T>[];
  selected: readonly T[];
  onToggle: (value: T, checked: boolean) => void;
  /** Small print under the grid; typically the artifact semantics. */
  hint?: string;
}

const styles = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: space.px8,
  },
  infoIcon: {
    color: colors.gray400,
  },
});

/**
 * Labelled multi-select checkbox grid.
 *
 * Same visual contract as `SelectField` (label above the control, shared
 * `controls.field*` styles), but for choices that are not mutually exclusive.
 */
export default function CheckboxGroupField<T extends string>(
  props: CheckboxGroupFieldProps<T>,
) {
  const labelId = createUniqueId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      {...stylex.attrs(controls.field)}
    >
      <span id={labelId} {...stylex.attrs(controls.fieldLabel)}>
        {props.label}
      </span>
      <div {...stylex.attrs(styles.grid)}>
        <For each={props.options}>
          {(option) => (
            <label {...stylex.attrs(forms.checkboxLabel)} title={option.description}>
              <input
                type="checkbox"
                checked={props.selected.includes(option.value)}
                onChange={(e) => props.onToggle(option.value, e.currentTarget.checked)}
              />
              {option.label}
              <Show when={option.description}>
                <Info
                  aria-hidden="true"
                  class={stylex.attrs(icons.xs, layout.noShrink, styles.infoIcon).class}
                />
              </Show>
            </label>
          )}
        </For>
      </div>
      <Show when={props.hint}>
        <p {...stylex.attrs(typography.metaMuted)}>{props.hint}</p>
      </Show>
    </div>
  );
}
