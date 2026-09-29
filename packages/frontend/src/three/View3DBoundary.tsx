import { Component, type ReactNode } from 'react';

// If the lazy 3D chunk fails to load or the scene throws while rendering, fall back
// to the 2D table instead of blanking the whole app.
export class View3DBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('3D table failed, falling back to 2D:', error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
