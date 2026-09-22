// Page navigation does not reliably unmount React before a browser makes its document inactive.
// WebKit can reject reads after beforeunload but before pagehide while visibility still says visible.
// Pause at the earliest navigation signal; focus/interaction resumes a cancelled navigation safely.
// Each poll is bounded to one concurrent refresh and never starts while hidden or offline.
export function startLibraryPolling(refresh: (signal: AbortSignal) => Promise<unknown>, reportFailure: (failure: unknown) => void) {
  let stopped = false;
  let disposed = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const poll = async () => {
    if (stopped || controller || document.visibilityState !== "visible" || !navigator.onLine) return;
    const current = new AbortController();
    controller = current;
    try { await refresh(current.signal); }
    catch (failure) { if (!current.signal.aborted && !stopped) reportFailure(failure); }
    finally { current.abort(); if (controller === current) controller = null; }
  };
  const pause = () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  const resume = () => {
    if (disposed || document.visibilityState !== "visible" || !stopped) return;
    stopped = false;
    if (timer === null) timer = setInterval(() => void poll(), 10000);
    void poll();
  };
  const restorePage = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
  const visibilityChanged = () => { if (document.visibilityState === "hidden") pause(); else resume(); };
  timer = setInterval(() => void poll(), 10000);
  window.addEventListener("beforeunload", pause);
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", restorePage);
  window.addEventListener("focus", resume);
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);
  document.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    disposed = true;
    pause();
    window.removeEventListener("beforeunload", pause);
    window.removeEventListener("pagehide", pause);
    window.removeEventListener("pageshow", restorePage);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
