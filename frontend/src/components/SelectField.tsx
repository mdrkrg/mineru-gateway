import * as stylex from '@stylexjs/stylex';
import { For, Show } from 'solid-js';
import { controls } from '@/styles/controls.stylex';

export interface SelectFieldOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: string;
  options: readonly SelectFieldOption<T>[];
  onChange: (value: T) => void;
  /** Rendered first, with an empty value, so filters can mean "all". */
  placeholder?: string;
}

/**
 * Labelled native `<select>` used by parse and filter forms.
 *
 * Options carry already-translated labels so callers can build them in a
 * `createMemo` and keep them reactive to locale changes.
 */
export default function SelectField<T extends string>(props: SelectFieldProps<T>) {
  return (
    <label {...stylex.attrs(controls.field)}>
      <span {...stylex.attrs(controls.fieldLabel)}>{props.label}</span>
      <select
        onChange={(e) => props.onChange(e.currentTarget.value as T)}
        {...stylex.attrs(controls.input)}
      >
        <Show when={props.placeholder !== undefined}>
          <option value="" selected={props.value === ''}>{props.placeholder}</option>
        </Show>
        {/* Localized options may be recreated without the value changing. */}
        <For each={props.options}>
          {(option) => (
            <option value={option.value} selected={props.value === option.value}>
              {option.label}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}
