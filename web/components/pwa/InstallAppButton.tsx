"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isIosUserAgent(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;

  const standaloneNavigator = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    standaloneNavigator.standalone === true
  );
}

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIosInstallable, setIsIosInstallable] = useState(false);

  useEffect(() => {
    let active = true;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-blocking registration failure; app still works without install features.
      });
    }

    const updateInstalledState = () => {
      if (!active) return;
      setIsInstalled(isStandaloneDisplayMode());
    };

    updateInstalledState();

    const media = window.matchMedia?.("(display-mode: standalone)");
    const onDisplayModeChange = () => updateInstalledState();
    media?.addEventListener?.("change", onDisplayModeChange);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!active) return;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      if (!active) return;
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
    window.addEventListener("appinstalled", onAppInstalled);

    setIsIosInstallable(isIosUserAgent() && !isStandaloneDisplayMode());

    return () => {
      active = false;
      media?.removeEventListener?.("change", onDisplayModeChange);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt as EventListener);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const canPromptInstall = useMemo(() => !isInstalled && deferredPrompt !== null, [deferredPrompt, isInstalled]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (isInstalled) return null;

  if (canPromptInstall) {
    return (
      <button
        type="button"
        onClick={handleInstallClick}
        className="rounded border border-brand-500/70 px-2 py-1 text-[11px] font-medium text-brand-300 transition-colors hover:border-brand-400 hover:text-brand-200 sm:text-xs"
      >
        Install App
      </button>
    );
  }

  if (isIosInstallable) {
    return (
      <Link
        href="/install"
        className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white sm:text-xs"
      >
        Install Guide
      </Link>
    );
  }

  return null;
}
