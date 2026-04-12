const meta = {
  title: 'Design/Primitives',
}

export default meta

export const Buttons = {
  render: () => (
    <div className="flex gap-2 bg-gray-950 p-4 rounded">
      <button className="btn-primary">Primary</button>
      <button className="btn-ghost">Ghost</button>
      <button className="btn-danger">Danger</button>
      <button className="btn-warning">Warning</button>
    </div>
  ),
}

export const InputsAndBadges = {
  render: () => (
    <div className="space-y-3 bg-gray-950 p-4 rounded w-[420px]">
      <div>
        <label className="label">Ticker</label>
        <input className="input w-full" defaultValue="SPY" />
      </div>
      <div className="flex gap-2">
        <span className="badge-backtest">Backtest</span>
        <span className="badge-paper">Paper</span>
        <span className="badge-live">Live</span>
      </div>
    </div>
  ),
}

export const MetricCards = {
  render: () => (
    <div className="grid grid-cols-3 gap-3 bg-gray-950 p-4 rounded w-[640px]">
      <div className="metric-card">
        <div className="metric-label">Total Return</div>
        <div className="metric-value positive">+12.4%</div>
      </div>
      <div className="metric-card">
        <div className="metric-label">Sharpe</div>
        <div className="metric-value neutral">1.42</div>
      </div>
      <div className="metric-card">
        <div className="metric-label">Max DD</div>
        <div className="metric-value negative">-6.8%</div>
      </div>
    </div>
  ),
}

export const KillModalPattern = {
  render: () => (
    <div className="bg-black/70 p-6 rounded w-[520px]">
      <div className="bg-gray-900 border border-red-800 rounded-lg shadow-2xl p-6 w-full">
        <h2 className="text-lg font-bold text-red-400 mb-3">Confirm Kill Switch</h2>
        <p className="text-sm text-gray-300 mb-4">Immediately stop trading across selected scope.</p>
        <div className="space-y-3">
          <div>
            <label className="label">Scope</label>
            <select className="input w-full">
              <option>Global (all trading)</option>
              <option>Strategy only</option>
            </select>
          </div>
          <div>
            <label className="label">Reason</label>
            <input className="input w-full" placeholder="Emergency reason..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost text-sm">Cancel</button>
          <button className="btn-danger text-sm">Execute Kill</button>
        </div>
      </div>
    </div>
  ),
}
