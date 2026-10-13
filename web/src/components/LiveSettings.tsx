import { useEffect, useRef, useState } from "react";
import { useSnapshot } from "../data/api";
import { connect, disconnect, getKey, MAX_SYMBOLS, setKey, subscriptions } from "../live/finnhub";
import { useLive } from "../live/store";
import { useUi } from "../state/store";

/** Modal for the optional Finnhub live feed. */
export function LiveSettings() {
  const { settingsOpen, setSettingsOpen } = useUi();
  const { data: snap } = useSnapshot();
  const { status, error } = useLive();
  const [draft, setDraft] = useState(() => getKey() ?? "");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (settingsOpen && !d.open) d.showModal();
    if (!settingsOpen && d.open) d.close();
  }, [settingsOpen]);

  // reconnect on load if the visitor saved a key earlier
  useEffect(() => {
    if (snap && getKey() && useLive.getState().status === "off") connect(snap.companies);
  }, [snap]);

  const n = snap ? subscriptions(snap.companies).size : 0;

  return (
    <dialog
      ref={dialog}
      onClose={() => setSettingsOpen(false)}
      aria-labelledby="live-title"
      className="m-auto w-[min(480px,92vw)] border border-rule-strong bg-raised p-0 text-ink backdrop:bg-black/50"
    >
      <form
        method="dialog"
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setKey(draft);
          if (snap && draft.trim()) connect(snap.companies);
          setSettingsOpen(false);
        }}
      >
        <h2 id="live-title" className="font-cond text-[16px] font-semibold">
          Live prices (optional)
        </h2>
        <p className="text-ink-2">
          The site works from a static snapshot refreshed every 30 minutes in market hours. Paste your own free{" "}
          <a className="text-focus underline" href="https://finnhub.io/register" target="_blank" rel="noreferrer">
            Finnhub API key
          </a>{" "}
          to stream trades for the {n} largest US-listed companies (cap {MAX_SYMBOLS}). Market caps update as trades arrive;
          non-US listings stay on the snapshot.
        </p>
        <p className="text-[11px] text-ink-3">
          Your key is stored only in this browser (localStorage) and sent only to finnhub.io. Clearing it disconnects.
        </p>
        <label className="block">
          <span className="label">Finnhub API key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-0.5 w-full border border-rule bg-surface px-2 py-1.5 font-mono"
          />
        </label>
        <div className="text-[12px]">
          Status: <span className={status === "live" ? "text-up" : status === "error" ? "text-down" : "text-ink-2"}>{status}</span>
          {error && <span className="text-down"> — {error}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="border border-rule px-3 py-1 text-ink-2"
            onClick={() => {
              setKey(null);
              setDraft("");
              disconnect();
            }}
          >
            Clear key
          </button>
          <button type="button" className="border border-rule px-3 py-1 text-ink-2" onClick={() => setSettingsOpen(false)}>
            Close
          </button>
          <button type="submit" className="bg-ink px-3 py-1 text-surface">
            Connect
          </button>
        </div>
      </form>
    </dialog>
  );
}
