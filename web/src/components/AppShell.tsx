import { type ReactNode, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useSnapshot } from "../data/api";
import { ago } from "../lib/format";
import { useUi, type Theme } from "../state/store";
import { TickerTape } from "./TickerTape";
import { StatusPill } from "./StatusPill";
import { CompanyDrawer } from "./CompanyDrawer";
import { LiveSettings } from "./LiveSettings";

const NAV = [
  { to: "/", label: "Stack", end: true },
  { to: "/network", label: "Network" },
  { to: "/flow", label: "Value flow" },
  { to: "/simulator", label: "Simulator" },
  { to: "/analytics", label: "Analytics" },
  { to: "/health", label: "Pipeline" },
];

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 pr-4">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        {["apps", "models", "cloud", "chips", "semicap", "infra", "power"].map((l, i) => (
          <rect key={l} x="0" y={i * 2.6} width="18" height="2" fill={`var(--layer-${l})`} />
        ))}
      </svg>
      <span className="font-cond text-[15px] font-semibold tracking-tight text-ink">AI Stack Atlas</span>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex border border-rule">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 font-cond text-[12px] ${
            value === o.value ? "bg-ink text-surface" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: snap } = useSnapshot();
  const { attribution, setAttribution, theme, setTheme, setSettingsOpen } = useUi();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000); // keep "updated N min ago" fresh
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-raised focus:p-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-2">
          <Wordmark />
          <nav aria-label="Views" className="flex flex-wrap items-center">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `border-b-2 px-2.5 py-1 font-cond text-[13px] ${
                    isActive ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <StatusPill generatedAt={snap?.generated_at} />
            <Segmented
              label="Layer attribution"
              value={attribution}
              onChange={setAttribution}
              options={[
                { value: "primary", label: "Primary layer", title: "Each company's full market cap counts in its primary layer" },
                { value: "segment", label: "By segment", title: "Market cap split across layers by reported revenue segment" },
              ]}
            />
            <Segmented<Theme>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "system", label: "Auto" },
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
            <button
              onClick={() => setSettingsOpen(true)}
              className="border border-rule px-2 py-1 font-cond text-[12px] text-ink-2 hover:text-ink"
            >
              Live data…
            </button>
          </div>
        </div>
        {snap && <TickerTape snap={snap} />}
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <CompanyDrawer />
      <LiveSettings />
      <footer className="border-t border-rule px-4 py-2 text-[11px] text-ink-3">
        <span className="text-ink-2">Illustrative model, not a forecast or financial advice.</span>{" "}
        {snap && (
          <span className="num">
            Prices as of {snap.as_of} · snapshot {ago(snap.generated_at)} · {snap.companies.length} companies ·{" "}
            {snap.edges.length} cited relationships
          </span>
        )}
        {" · "}
        <a className="underline decoration-rule-strong underline-offset-2 hover:text-ink" href="https://github.com/pranavparuchur1/ai-stack-atlas#methodology">
          Methodology & sources
        </a>
      </footer>
    </div>
  );
}
