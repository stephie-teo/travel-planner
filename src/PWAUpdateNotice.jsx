import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import "./PWAUpdateNotice.css";

/**
 * PWA update notification. The service worker is only activated after the
 * user explicitly clicks Update Now, so unfinished form input isn't lost.
 */
export default function PWAUpdateNotice() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let intervalId;
    let registration;
    let disposed = false;

    const requestUpdate = () => {
      if (registration && navigator.onLine) {
        registration.update().catch((error) =>
          console.warn("PWA update check failed:", error)
        );
      }
    };

    const applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        if (!disposed) setNeedRefresh(true);
      },
      onRegisteredSW(_swUrl, swRegistration) {
        if (disposed || !swRegistration) return;
        registration = swRegistration;
        // Check periodically and when the user returns to the tab.
        intervalId = window.setInterval(requestUpdate, 60 * 60 * 1000);
        requestUpdate();
      },
      onRegisterError(error) {
        console.warn("PWA registration failed:", error);
      },
    });

    setUpdateSW(() => applyUpdate);
    const onVisible = () => {
      if (document.visibilityState === "visible") requestUpdate();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", requestUpdate);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", requestUpdate);
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <aside className="pwa-update-notice" role="status" aria-live="polite">
      <div className="pwa-update-copy">
        <strong>✨ New version available!</strong>
        <span>Update now to get the latest improvements.</span>
      </div>
      <div className="pwa-update-actions">
        <button
          type="button"
          className="pwa-update-primary"
          disabled={updating}
          onClick={async () => {
            if (!updateSW) return;
            setUpdating(true);
            try {
              await updateSW(true);
            } catch (error) {
              console.error("Unable to apply PWA update:", error);
              setUpdating(false);
            }
          }}
        >
          {updating ? "Updating…" : "Update Now"}
        </button>
        <button
          type="button"
          className="pwa-update-later"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
      </div>
    </aside>
  );
}
