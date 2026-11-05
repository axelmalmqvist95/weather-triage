import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  fallback: (error: unknown) => ReactNode;
  children: ReactNode;
}
interface State {
  error: unknown;
  hasError: boolean;
}

/** Fångar fel vid rendering och misslyckad lazy-laddning. Återställs genom att föräldern byter `key`. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    return this.state.hasError ? this.props.fallback(this.state.error) : this.props.children;
  }
}
