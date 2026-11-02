import { createSignal } from 'solid-js';
import { getGatewayConfig } from '@/api/functions/config';

export interface ConfigStore {
  /** Whether the gateway serves the login/JWT stack. Defaults to `true`. */
  userAuthEnabled: () => boolean;
  /** OIDC providers the login page may link to; empty when logins are off. */
  providers: () => { name: string }[];
  /**
   * True once `/v1/config` has been read successfully. Failed reads retry on
   * the next navigation, so the `true` fallback below is never sticky.
   */
  isLoaded: () => boolean;
  init: () => Promise<void>;
}

/**
 * Public gateway capabilities.
 *
 * The fallback is `userAuthEnabled: true`: if `/v1/config` cannot be read the
 * gateway is unreachable anyway, and defaulting to the login flow keeps the
 * existing behaviour instead of stranding the user on a key-entry screen.
 */
export function createConfigStore(): ConfigStore {
  const [userAuthEnabled, setUserAuthEnabled] = createSignal(true);
  const [providers, setProviders] = createSignal<{ name: string }[]>([]);
  const [isLoaded, setIsLoaded] = createSignal(false);

  async function init() {
    // The root beforeLoad runs on every navigation; capabilities change only
    // when the gateway is redeployed, so read them once (and retry on failure).
    if (isLoaded()) return;
    const result = await getGatewayConfig();
    if (result.isErr()) return;
    setUserAuthEnabled(result.value.userAuthEnabled);
    setProviders(result.value.providers);
    setIsLoaded(true);
  }

  return { userAuthEnabled, providers, isLoaded, init };
}
