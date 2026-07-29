import type { JSX } from 'solid-js';
import Header from './Header';
import Sidebar from './Sidebar';

/**
 * Authenticated application chrome: sidebar navigation on the left,
 * header with breadcrumb + user menu on top, page content in the main area.
 */
export default function AppShell(props: { children: JSX.Element }) {
  return (
    <div class="min-h-screen flex bg-gray-50">
      <Sidebar />
      <div class="flex-1 flex flex-col min-w-0">
        <Header />
        <main class="flex-1 p-6 overflow-y-auto">{props.children}</main>
      </div>
    </div>
  );
}
