// Page navigation does not reliably unmount React before a browser makes its document inactive.
// Stop timers and abort pending reads on pagehide; a restored back/forward-cache page resumes once.
// Each poll is bounded to one concurrent refresh and never starts while hidden or offline.
export function startLibraryPolling(refresh: (signal: AbortSignal) => Promise<unknown>, reportFailure: (failure: unknown) => void) {
  let stopped = false;
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
  const resume = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    stopped = false;
    if (timer === null) timer = setInterval(() => void poll(), 10000);
    void poll();
  };
  timer = setInterval(() => void poll(), 10000);
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", resume);
  return () => {
    pause();
    window.removeEventListener("pagehide", pause);
    window.removeEventListener("pageshow", resume);
  };
}
