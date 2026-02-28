import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Install",
  description: "Install Ice Cream Social on your phone home screen.",
};

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">Install on Your Phone</h1>
        <p className="text-sm text-gray-400">
          Add Ice Cream Social to your home screen for faster launch and a full-screen app-like view.
        </p>
      </header>

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
        <h2 className="text-base font-semibold text-white">iPhone / iPad (Safari)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-300">
          <li>Open this site in Safari.</li>
          <li>Tap the Share button.</li>
          <li>Tap "Add to Home Screen".</li>
          <li>Tap "Add" to confirm.</li>
        </ol>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
        <h2 className="text-base font-semibold text-white">Android (Chrome)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-300">
          <li>Open this site in Chrome.</li>
          <li>If prompted, tap "Install app".</li>
          <li>If not prompted, open the browser menu and tap "Install app" or "Add to Home screen".</li>
        </ol>
      </section>

      <p className="text-xs text-gray-500">
        Install support can vary by browser and version. If install is unavailable, bookmarking still works.
      </p>
    </div>
  );
}
