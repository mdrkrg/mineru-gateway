import { createFileRoute } from '@tanstack/solid-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div>
      <h1 class="text-2xl font-bold mb-4">MinerU Gateway</h1>
      <p>API-Key gateway for MinerU</p>
    </div>
  );
}
