"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shows page 1 of a certificate PDF as an image, drawn by pdf.js (loaded only when a preview is shown).
 * Browsers can't be relied on to display a PDF inline (most phones don't), so the page is rendered to a canvas.
 * Give either `url` (fetched from the API) or `data` (PDF bytes already fetched); give a new `key` to show another.
 */
export function CertificatePreview({ url, data, label }: { url?: string; data?: ArrayBuffer; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    (async () => {
      // The legacy build: the modern one needs very recent browsers (e.g. Math.sumPrecise).
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // Copied from node_modules by scripts/copy-pdfjs.mjs.
      const assets = `/pdfjs/${pdfjs.version}/`;
      pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.js`;
      const task = pdfjs.getDocument({
        // pdf.js takes over the bytes it is given: pass a copy so `data` stays usable.
        ...(data ? { data: new Uint8Array(data.slice(0)) } : { url }),
        standardFontDataUrl: `${assets}standard_fonts/`,
        useSystemFonts: false,
      });
      cleanup = () => void task.destroy();
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      // Sharp on the screen it is shown on, within sensible limits.
      const natural = page.getViewport({ scale: 1 });
      const wanted = Math.min(2000, Math.max(1000, (canvas.parentElement?.clientWidth ?? 800) * window.devicePixelRatio));
      const viewport = page.getViewport({ scale: wanted / natural.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (!cancelled) setState("ready");
    })().catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [url, data]);

  return (
    <div className="overflow-hidden rounded-xl border border-line-2 bg-white/[0.03] shadow-[0_20px_60px_-30px_rgb(0_0_0/0.8)]">
      <canvas ref={canvasRef} role="img" aria-label={label} className={state === "ready" ? "block h-auto w-full" : "hidden"} />
      {state !== "ready" && (
        <div className="grid aspect-[1.414] place-items-center p-6 text-center text-sm text-muted">
          {state === "loading" ? "Loading preview…" : "The preview couldn't be shown in this browser."}
        </div>
      )}
    </div>
  );
}
