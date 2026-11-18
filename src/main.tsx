// SPDX-License-Identifier: AGPL-3.0-or-later

import {Component, ErrorInfo, ReactNode, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class RootErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  declare props: Readonly<{children: ReactNode}>;
  state: ErrorBoundaryState = {hasError: false, message: ''};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {hasError: true, message: error?.message || 'Unexpected runtime error'};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Root render failure:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d0d0d] text-[#f0f0f0] font-mono p-8 flex items-center justify-center">
          <div className="max-w-xl w-full border border-[#383838] bg-[#141414] p-6">
            <div className="h-1 w-full bg-gradient-to-r from-[#c30800] via-[#c300bb] to-[#bbc300] mb-4" />
            <h1 className="text-sm font-bold uppercase tracking-wider text-[#c3005a] mb-2">
              RUNTIME_FAULT // RENDER_ABORTED
            </h1>
            <p className="text-xs text-[#8c8c8c] mb-4 break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-[#141414] hover:bg-[#262626] text-[#f0f0f0] border border-[#383838] cursor-pointer"
            >
              RELOAD
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
