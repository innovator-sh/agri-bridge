import type { Metadata } from 'next';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Offline - AgriBridge',
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-green-700 p-8 text-center text-white">
      <div className="max-w-sm">
        <h1 className="mb-3 text-2xl font-semibold">You are offline</h1>
        <p className="mb-6 opacity-90">
          AgriBridge needs an internet connection to load this page. Please check your connection and try again.
        </p>
        {/* Plain anchor on purpose: a full reload lets the service worker retry the network. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-block rounded-lg border border-white/40 bg-white/20 px-6 py-3 font-medium hover:bg-white/30"
        >
          Try again
        </a>
      </div>
    </main>
  );
}
