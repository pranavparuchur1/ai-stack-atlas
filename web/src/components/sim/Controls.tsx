import type { Marked } from "../../data/derived";
import type { ModelParams, RelationType, ShockType } from "../../engine/types";
import { usd } from "../../lib/format";
import { SHOCKS } from "./shocks";
import type { SnapshotLayer } from "../../types";


const PCT_RANGE: Record<Exclude<ShockType, "ipo">, [number, number, number]> = {
  valuation_change: [-0.6, 2, 0.01],
  earnings_beat_miss: [-0.3, 0.3, 0.005],
  supply_shock: [-1, 0, 0.01],
  demand_shock: [-0.5, 0.5, 0.01],
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-2">
      <span className="truncate text-ink-2">{label}</span>
      <span className="num text-right text-ink">{format(value)}</span>
      <input
        className="col-span-2 w-full accent-[var(--ink-2)]"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </label>
  );
}

export interface ControlsState {
  companyId: string;
  type: ShockType;
  pct: number;
  valuationUsd: number;
}

export function Controls({
  state,
  setState,
  companies,
  layers,
  params,
  setParams,
  resetParams,
  showScenario = true,
}: {
  state: ControlsState;
  setState: (s: ControlsState) => void;
  companies: Marked[];
  layers: SnapshotLayer[];
  params: ModelParams;
  setParams: (p: ModelParams) => void;
  resetParams: () => void;
  showScenario?: boolean;
}) {
  const c = companies.find((x) => x.id === state.companyId);
  const isPrivate = c ? !c.is_public : false;
  const types = SHOCKS.filter((s) => s.type !== "ipo" || isPrivate);
  const range = state.type === "ipo" ? null : PCT_RANGE[state.type];
  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(state.type === "earnings_beat_miss" ? 1 : 0)}%`;
  const set = (patch: Partial<ControlsState>) => setState({ ...state, ...patch });

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3" hidden={!showScenario}>
        <legend className="mb-1 font-cond text-[14px] font-semibold">Scenario</legend>
        <label className="block">
          <span className="label">Company</span>
          <select
            className="mt-0.5 w-full border border-rule bg-raised px-2 py-1.5 text-ink"
            value={state.companyId}
            onChange={(e) => {
              const next = companies.find((x) => x.id === e.target.value);
              const type = state.type === "ipo" && next?.is_public ? "valuation_change" : state.type;
              set({ companyId: e.target.value, type, valuationUsd: next ? Math.round((next.cap * 1.5) / 1e9) * 1e9 : state.valuationUsd });
            }}
          >
            {[...layers].reverse().map((l) => (
              <optgroup key={l.id} label={l.name}>
                {companies
                  .filter((x) => x.primary_layer === l.id)
                  .sort((a, b) => b.cap - a.cap)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.is_public ? "" : " (private)"}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div role="radiogroup" aria-label="Event type" className="grid grid-cols-1 gap-1">
          {types.map((s) => (
            <label
              key={s.type}
              className={`flex cursor-pointer gap-2 border px-2 py-1.5 ${state.type === s.type ? "border-ink" : "border-rule"}`}
            >
              <input type="radio" name="shock" checked={state.type === s.type} onChange={() => set({ type: s.type })} className="mt-1" />
              <span>
                <span className="font-cond text-ink">{s.label}</span>
                <span className="block text-[11px] text-ink-3">{s.help}</span>
              </span>
            </label>
          ))}
        </div>
        {state.type === "ipo" && c ? (
          <div>
            <Slider
              label={`Listing valuation (last round ${usd(c.cap)})`}
              value={state.valuationUsd}
              min={Math.round(c.cap * 0.5)}
              max={Math.round(c.cap * 3)}
              step={Math.max(1e9, Math.round(c.cap / 200))}
              format={(v) => usd(v)}
              onChange={(v) => set({ valuationUsd: v })}
            />
            <div className="mt-1 text-[11px] text-ink-3">
              = {((state.valuationUsd / c.cap - 1) * 100).toFixed(0)}% vs. the last private round
            </div>
          </div>
        ) : (
          range && (
            <Slider
              label={SHOCKS.find((s) => s.type === state.type)!.label}
              value={state.pct}
              min={range[0]}
              max={range[1]}
              step={range[2]}
              format={fmtPct}
              onChange={(v) => set({ pct: v })}
            />
          )
        )}
      </fieldset>

      <fieldset className="space-y-2.5">
        <legend className="mb-1 flex w-full items-baseline justify-between font-cond text-[14px] font-semibold">
          Model assumptions
          <button type="button" onClick={resetParams} className="font-cond text-[12px] font-normal text-ink-2 underline">
            reset
          </button>
        </legend>
        <Slider label="Decay per hop" value={params.decay} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setParams({ ...params, decay: v })} />
        <Slider label="Max hops" value={params.max_hops} min={1} max={4} step={1} format={(v) => String(v)} onChange={(v) => setParams({ ...params, max_hops: v })} />
        <Slider label="Beta blend (hop ≥ 2)" value={params.beta_blend} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setParams({ ...params, beta_blend: v })} />
        <Slider
          label="Valuation → demand pass-through"
          value={params.valuation_to_demand}
          min={0}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => setParams({ ...params, valuation_to_demand: v })}
        />
        <Slider
          label="Undisclosed contract = % of revenue"
          value={params.null_magnitude_share}
          min={0}
          max={0.1}
          step={0.005}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          onChange={(v) => setParams({ ...params, null_magnitude_share: v })}
        />
        <details className="border-t border-rule pt-2">
          <summary className="cursor-pointer font-cond text-ink-2">Elasticity per relationship (up = demand, down = supply)</summary>
          <div className="mt-2 space-y-2">
            {(Object.keys(params.elasticity) as RelationType[])
              .filter((r) => r !== "equity_stake")
              .map((r) => (
                <div key={r} className="grid grid-cols-2 gap-2">
                  {(["up", "down"] as const).map((dir) => (
                    <Slider
                      key={dir}
                      label={`${r.replace(/_/g, " ")} ${dir === "up" ? "↑" : "↓"}`}
                      value={params.elasticity[r][dir]}
                      min={0}
                      max={1.5}
                      step={0.05}
                      format={(v) => v.toFixed(2)}
                      onChange={(v) =>
                        setParams({ ...params, elasticity: { ...params.elasticity, [r]: { ...params.elasticity[r], [dir]: v } } })
                      }
                    />
                  ))}
                </div>
              ))}
          </div>
        </details>
      </fieldset>
    </div>
  );
}
