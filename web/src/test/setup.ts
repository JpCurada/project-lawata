// Vitest setup (jsdom). jsdom has no IntersectionObserver; Motion's useInView (Arc TextShimmer) needs one.
// Only fills gaps, so tests that stub globals themselves (e.g. vi.stubGlobal("matchMedia", ...)) still win.
class NoopIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds: readonly number[] = [0];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = NoopIntersectionObserver;
}

// jsdom's window.scrollTo only logs "Not implemented"; the Shell scrolls to the top on navigation.
window.scrollTo = () => undefined;
