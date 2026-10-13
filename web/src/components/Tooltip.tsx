import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** Pointer-following tooltip that flips to stay inside the viewport. */
export function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y + 14 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + 14 + width > window.innerWidth - 8 ? x - width - 14 : x + 14;
    const top = y + 14 + height > window.innerHeight - 8 ? y - height - 14 : y + 14;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-[300px] border border-rule-strong bg-raised px-3 py-2 text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      style={pos}
    >
      {children}
    </div>
  );
}
