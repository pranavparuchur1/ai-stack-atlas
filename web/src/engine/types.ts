/** Types for the propagation engine and backtests (filled out in the simulator phase). */

export interface BacktestEventResult {
  id: string;
}

export interface Backtests {
  events: BacktestEventResult[];
}
