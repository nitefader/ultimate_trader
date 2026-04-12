import React from 'react'

type ErrorBoundaryProps = {
  children: React.ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
  errorMessage?: string
  stack?: string
  killSwitchActive: boolean | null
  checkingKillSwitch: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: undefined,
    stack: undefined,
    killSwitchActive: null,
    checkingKillSwitch: false,
  }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true }
  }

  async componentDidCatch(error: Error, errorInfo: React.ErrorInfo): Promise<void> {
    this.setState({
      errorMessage: error.message,
      stack: errorInfo.componentStack ?? undefined,
    })

    try {
      this.setState({ checkingKillSwitch: true })
      const response = await fetch('/api/v1/control/status')
      if (response.ok) {
        const payload = await response.json()
        this.setState({ killSwitchActive: !!payload?.kill_switch?.global_killed })
      }
    } catch {
      this.setState({ killSwitchActive: null })
    } finally {
      this.setState({ checkingKillSwitch: false })
    }
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoDashboard = () => {
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
        <div className="max-w-3xl mx-auto card border-red-800 bg-red-950/30 space-y-4">
          <h1 className="text-xl font-bold text-red-300">Application Error</h1>
          <p className="text-sm text-gray-300">
            A runtime error occurred. Use the controls below to recover safely.
          </p>

          <div className="rounded border border-gray-800 bg-gray-900 p-3 text-sm">
            <div className="text-gray-400">Kill Switch Status</div>
            {this.state.checkingKillSwitch && <div className="text-gray-300">Checking...</div>}
            {!this.state.checkingKillSwitch && this.state.killSwitchActive === true && (
              <div className="text-red-300 font-semibold">ACTIVE: all trading is stopped</div>
            )}
            {!this.state.checkingKillSwitch && this.state.killSwitchActive === false && (
              <div className="text-emerald-300 font-semibold">NOT ACTIVE</div>
            )}
            {!this.state.checkingKillSwitch && this.state.killSwitchActive === null && (
              <div className="text-amber-300">Status unavailable</div>
            )}
          </div>

          {this.state.errorMessage && (
            <div className="text-sm text-red-200">{this.state.errorMessage}</div>
          )}

          {this.state.stack && (
            <details className="text-xs text-gray-300 rounded border border-gray-800 bg-gray-900 p-3 whitespace-pre-wrap">
              <summary className="cursor-pointer text-gray-200">Show stack trace</summary>
              {this.state.stack}
            </details>
          )}

          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={this.handleReload}>Reload Page</button>
            <button className="btn-ghost" onClick={this.handleGoDashboard}>Go to Dashboard</button>
          </div>
        </div>
      </div>
    )
  }
}
