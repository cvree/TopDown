import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The one place a crash is allowed to reach.
 *
 * A trainer that shows a stack trace has told the player two things: that
 * something broke, and that nobody thought about what happens when it does.
 * This says what failed in their terms, states plainly that the profile is
 * untouched — it is written to storage between runs, not during them — and
 * gives them the two ways out.
 *
 * The real error still goes to the console, because the person debugging it
 * needs it and the person training does not.
 */

interface Props {
  children: ReactNode;
  /** What was being shown, in the player's words. */
  what?: string;
  /** Retrying re-mounts the subtree. Omitted where there is nothing to retry. */
  onRetry?: () => void;
  onExit?: () => void;
  exitLabel?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[apex] render failure', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  private leave = (): void => {
    this.setState({ error: null });
    this.props.onExit?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { what = 'This screen', onRetry, onExit, exitLabel = 'Return to training' } = this.props;

    return (
      <div className="fail-screen">
        <div className="fail-card scale-in">
          <div className="eyebrow">Something went wrong</div>
          <h2 className="display">{what.toUpperCase()} FAILED TO LOAD</h2>
          <div className="ornament">
            <i />
          </div>
          <p>
            Your profile is safe — ratings, records and history are written between runs, never during one,
            so nothing that was already earned can be lost to this.
          </p>
          <div className="fail-actions">
            {onRetry && (
              <button className="btn primary lg" onClick={this.reset}>
                Try again
              </button>
            )}
            {onExit && (
              <button className="btn lg" onClick={this.leave}>
                {exitLabel}
              </button>
            )}
            <button className="btn ghost lg" onClick={() => window.location.reload()}>
              Reload APEX
            </button>
          </div>
          <details className="fail-detail">
            <summary>Technical detail</summary>
            <code>{error.message}</code>
          </details>
        </div>
      </div>
    );
  }
}
