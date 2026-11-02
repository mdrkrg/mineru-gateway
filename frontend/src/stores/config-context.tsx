import { createContext, useContext } from 'solid-js';
import type { JSX } from 'solid-js';
import type { ConfigStore } from '@/stores/config';

const ConfigCtx = createContext<ConfigStore>();

/**
 * Access the gateway config store from any component inside
 * {@link ConfigProvider}.
 *
 * @throws If called outside a {@link ConfigProvider}.
 */
export function useConfig(): ConfigStore {
  const ctx = useContext(ConfigCtx);
  if (!ctx) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return ctx;
}

/** Provides the gateway config store to the component tree. */
export function ConfigProvider(props: {
  store: ConfigStore;
  children: JSX.Element;
}) {
  return <ConfigCtx.Provider value={props.store}>{props.children}</ConfigCtx.Provider>;
}
