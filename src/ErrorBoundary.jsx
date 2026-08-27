import React from 'react';

// A render throw anywhere previously unmounted the entire app to a blank dark
// page — while the native employer-page view stayed floating over it. This
// boundary keeps the failure visible, reports it to the application
// diagnostics log, and offers a way out without losing local data.
export default class ApplicationErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    try { window.desktopShell?.reportRendererError?.({ message: String(error?.message || error), stack: [String(error?.stack || ''), String(info?.componentStack || '')].filter(Boolean).join('\n--- component stack ---\n') }); } catch { /* reporting must never throw */ }
  }
  render() {
    if (!this.state.error) return this.props.children;
    const detail = String(this.state.error?.message || this.state.error || 'Unknown render error');
    return <div role="alert" style={{ maxWidth: 720, margin: '80px auto', padding: 24, border: '1px solid #b76363', borderRadius: 12, background: '#2a1a1d', color: '#f0ddd8' }}>
      <h2 style={{ marginTop: 0 }}>The workspace hit an unexpected error.</h2>
      <p style={{ fontSize: 13, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{detail}</p>
      <p style={{ fontSize: 11, color: '#c9a5a0' }}>Details were saved to the application diagnostics log. Reload to continue; your data is stored locally and was not affected.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" onClick={() => window.location.reload()}>Reload</button>
        <button className="secondary" onClick={() => { navigator.clipboard?.writeText(String(this.state.error?.stack || detail)); }}>Copy details</button>
      </div>
    </div>;
  }
}