/// <reference types="google.maps" />
// Idempotent Google Maps JS API loader.
// Uses the Lovable-managed browser key (referrer-restricted to *.lovable.app / *.lovableproject.com).

let promise: Promise<typeof google> | null = null;

declare global {
  interface Window {
    __lovableInitGmaps?: () => void;
    google?: typeof google;
  }
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("google-maps-loader: window is not available"));
  }
  if (window.google?.maps) return Promise.resolve(window.google);
  if (promise) return promise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;
  if (!key) {
    return Promise.reject(new Error("ยังไม่ได้เชื่อม Google Maps connector"));
  }

  // Force preserveDrawingBuffer so the Street View WebGL canvas can be captured
  // via canvas.toDataURL() during PDF/PPTX export. Must run BEFORE the Google
  // Maps script creates any WebGL context.
  try {
    const proto = HTMLCanvasElement.prototype as HTMLCanvasElement & {
      __lovablePatched?: boolean;
    };
    if (!proto.__lovablePatched) {
      const orig = proto.getContext;
      proto.getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
          const merged = { ...(attrs as object | undefined), preserveDrawingBuffer: true };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (orig as any).call(this, type, merged);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any).call(this, type, attrs);
      } as typeof proto.getContext;
      proto.__lovablePatched = true;
    }
  } catch {
    // Non-fatal — capture will fall back to Street View Static API.
  }

  promise = new Promise((resolve, reject) => {
    window.__lovableInitGmaps = () => {
      if (window.google?.maps) resolve(window.google);
      else reject(new Error("Google Maps failed to initialise"));
    };
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      loading: "async",
      callback: "__lovableInitGmaps",
      libraries: "streetView",
    });
    if (channel) params.set("channel", channel);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("โหลด Google Maps script ล้มเหลว"));
    document.head.appendChild(s);
  });

  return promise;
}
