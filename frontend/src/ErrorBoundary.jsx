import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: '#1a0f14', color: '#ffb3c6', height: '100vh', overflow: 'auto', fontFamily: 'monospace', zIndex: 9999, position: 'relative' }}>
          <h1 style={{ color: '#ff4d6d' }}>Application Crashed!</h1>
          <p style={{ marginTop: 10, fontSize: 16 }}>The user interface encountered an unhandled error.</p>
          <p style={{ marginTop: 5, fontSize: 16, fontWeight: 'bold' }}>Please copy all the red text below and paste it in the chat:</p>
          
          <div style={{ background: '#000', padding: 20, borderRadius: 8, marginTop: 20, border: '1px solid #ff4d6d' }}>
            <strong style={{ fontSize: 18 }}>{this.state.error && this.state.error.toString()}</strong>
            <pre style={{ marginTop: 15, whiteSpace: 'pre-wrap', fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
              {this.state.errorInfo && this.state.errorInfo.componentStack}
            </pre>
          </div>
          
          <button 
            onClick={() => window.location.reload()}
            style={{ marginTop: 30, padding: '12px 24px', background: '#ff4d6d', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 16, fontWeight: 'bold' }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
