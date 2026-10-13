import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { StackView } from "./views/StackView";

// Heavy views (D3 force/sankey, simulator) are split into their own chunks.
const NetworkView = lazy(() => import("./views/NetworkView"));
const FlowView = lazy(() => import("./views/FlowView"));
const SimulatorView = lazy(() => import("./views/SimulatorView"));
const AnalyticsView = lazy(() => import("./views/AnalyticsView"));
const HealthView = lazy(() => import("./views/HealthView"));

function Loading() {
  return <div className="p-6 font-cond text-ink-3">Loading…</div>;
}

export function App() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<StackView />} />
          <Route path="/network" element={<NetworkView />} />
          <Route path="/flow" element={<FlowView />} />
          <Route path="/simulator" element={<SimulatorView />} />
          <Route path="/analytics" element={<AnalyticsView />} />
          <Route path="/health" element={<HealthView />} />
          <Route path="*" element={<StackView />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
