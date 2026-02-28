import type { Metadata, Viewport } from "next";
import Link from "next/link";
import InstallAppButton from "@/components/pwa/InstallAppButton";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ice Cream Social",
    template: "%s | Ice Cream Social",
  },
  description:
    "Fan wiki and episode guide for Matt and Mattingly's Ice Cream Social podcast.",
  keywords: ["Ice Cream Social", "Matt Donnelly", "Paul Mattingly", "podcast"],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    title: "Ice Cream Social",
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {/* ── Navigation ── */}
        <nav className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-white hover:text-brand-400 transition-colors"
            >
              <span className="text-xl">🍦</span>
              <span>Ice Cream Social</span>
            </Link>

            <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-gray-400 sm:gap-6 sm:text-sm">
              <InstallAppButton />
              <Link href="/episodes" className="hover:text-white transition-colors">
                Episodes
              </Link>
              <Link href="/wiki" className="hover:text-white transition-colors">
                Wiki
              </Link>
              <Link href="/search" className="hover:text-white transition-colors">
                Search
              </Link>
              <Link href="/admin" className="hover:text-white transition-colors">
                Admin
              </Link>
              <Link href="/login" className="hover:text-white transition-colors">
                Login
              </Link>
            </div>
          </div>
        </nav>

        {/* ── Main content ── */}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">{children}</main>

        {/* ── Footer ── */}
        <footer className="border-t border-gray-800 py-8 text-center text-xs text-gray-600">
          <p>
            Fan-made episode guide for{" "}
            <span className="text-gray-400">Matt and Mattingly&apos;s Ice Cream Social</span>
          </p>
        </footer>
      </body>
    </html>
  );
}
