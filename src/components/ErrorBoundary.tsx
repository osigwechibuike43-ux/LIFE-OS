import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui';

interface Props { children: ReactNode; fallbackTitle?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log type and component stack only; never user content.
    console.error('UI error:', error.name, info.componentStack?.split('\n').slice(0, 4).join(' '));
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
        <h2 className="text-xl font-semibold">{this.props.fallbackTitle ?? 'Something went wrong'}</h2>
        <p className="text-sm text-muted">This page hit an unexpected problem. Your data is safe. Reloading usually fixes it.</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
}
