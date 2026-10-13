import { useCallback, useEffect, useState } from "react";

type Size = { width: number; height: number };
const same = (a: Size, b: Size) => a.width === b.width && a.height === b.height;

/**
 * Tracks an element's content-box size. A callback ref measures on attach (so panels that mount
 * later work, and so does a tab whose frames are not being painted, where ResizeObserver is
 * silent); a ResizeObserver then follows later resizes.
 */
export function useElementSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const ref = useCallback((node: T | null) => {
    setEl(node);
    if (node) {
      const { width, height } = node.getBoundingClientRect();
      setSize((s) => (same(s, { width, height }) ? s : { width, height }));
    }
  }, []);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (same(s, { width, height }) ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, size] as const;
}
