import * as stylex from '@stylexjs/stylex';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { ChevronDown, Download, FileJson } from 'lucide-solid';
import { actions } from '@/styles/actions.stylex';
import { controls } from '@/styles/controls.stylex';
import { icons } from '@/styles/icons.stylex';
import { colors, radius, space } from '@/styles/tokens.stylex';
import { typography } from '@/styles/typography.stylex';

interface DownloadSplitButtonProps {
  label: string;
  /** Menu entry for MinerU's raw task response. */
  rawLabel: string;
  rawHint: string;
  disabled?: boolean;
  onDownload: () => void;
  onDownloadRaw: () => void;
}

const styles = stylex.create({
  wrapper: {
    display: 'inline-flex',
    minWidth: space.px224,
  },
  primary: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  trigger: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    paddingInline: space.px8,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: colors.whiteAlpha30,
  },
  menu: {
    zIndex: 30,
    padding: space.px4,
  },
  itemText: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.px2,
  },
  itemIcon: {
    color: colors.gray500,
    marginTop: space.px2,
  },
  menuItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.px8,
    paddingInline: space.px12,
    paddingBlock: space.px8,
    borderRadius: radius.px4,
    outlineStyle: 'none',
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.gray50,
      ':focus-visible': colors.gray50,
    },
  },
});

/**
 * Primary result download with an attached menu trigger.
 *
 * The two buttons share the primary style; the touching corners stay square so
 * they read as one control. The menu exposes MinerU's raw task response
 * (metadata and inline text, no binaries) as an inspection escape hatch.
 * Focus, arrow keys, Escape and outside clicks come from Kobalte.
 */
export default function DownloadSplitButton(props: DownloadSplitButtonProps) {
  // The menu spans the whole split control, so its edges line up with the
  // button. The width is measured because the label is translated text.
  const [menuWidth, setMenuWidth] = createSignal<number>();
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const element = root;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setMenuWidth(Math.round(element.getBoundingClientRect().width));
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={root} {...stylex.attrs(styles.wrapper)}>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => props.onDownload()}
        {...stylex.attrs(
          controls.button,
          controls.buttonPrimary,
          actions.disabled40,
          styles.primary,
        )}
      >
        <Download class={stylex.attrs(icons.sm).class} />
        {props.label}
      </button>
      <DropdownMenu placement="bottom-end" gutter={4}>
        <DropdownMenu.Trigger
          type="button"
          disabled={props.disabled}
          aria-label={props.rawLabel}
          class={
            stylex.attrs(
              controls.button,
              controls.buttonPrimary,
              actions.disabled40,
              styles.trigger,
            ).class
          }
        >
          <ChevronDown class={stylex.attrs(icons.sm).class} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            class={stylex.attrs(controls.popover, styles.menu).class}
            style={menuWidth() ? { width: `${menuWidth()}px` } : undefined}
          >
            <DropdownMenu.Item
              class={stylex.attrs(styles.menuItem).class}
              onSelect={() => props.onDownloadRaw()}
            >
              <FileJson class={stylex.attrs(icons.sm, styles.itemIcon).class} />
              <div {...stylex.attrs(styles.itemText)}>
                <DropdownMenu.ItemLabel
                  class={stylex.attrs(typography.body).class}
                >
                  {props.rawLabel}
                </DropdownMenu.ItemLabel>
                <DropdownMenu.ItemDescription
                  class={stylex.attrs(typography.metaMuted).class}
                >
                  {props.rawHint}
                </DropdownMenu.ItemDescription>
              </div>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
