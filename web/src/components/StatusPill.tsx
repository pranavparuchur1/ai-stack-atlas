import { ago } from "../lib/format";
import { useLive } from "../live/store";

/** "LIVE" when a WebSocket feed is connected, otherwise how old the static snapshot is. */
export function StatusPill({ generatedAt }: { generatedAt?: string }) {
  const status = useLive((s) => s.status);
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 font-cond text-[12px] text-up" aria-live="polite">
        <span className="h-1.5 w-1.5 rounded-full bg-up motion-safe:animate-pulse" aria-hidden /> LIVE
      </span>
    );
  }
  return (
    <span className="font-cond text-[12px] text-ink-3" aria-live="polite">
      {status === "connecting" ? "Connecting…" : "Snapshot"}
      {generatedAt && ` · updated ${ago(generatedAt)}`}
    </span>
  );
}
