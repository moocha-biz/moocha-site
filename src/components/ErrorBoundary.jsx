import React from 'react';

// Must be a class component — React only supports error boundaries via
// getDerivedStateFromError/componentDidCatch, there's no hook equivalent.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#FBF6EA', padding: 24, textAlign: 'center',
      }}>
        <div>
          <div style={{ fontFamily: "'Baloo 2', sans-serif", fontSize: 22, fontWeight: 800, color: '#2F5233', marginBottom: 8 }}>
            something went wrong 🍃
          </div>
          <div style={{ fontSize: 14, color: '#85A573', marginBottom: 22, maxWidth: 320 }}>
            Sorry about that — a refresh usually fixes it. Your cart is saved.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#4C8558', color: '#fff', border: 'none', padding: '13px 30px', borderRadius: 18,
              fontFamily: "'Baloo 2', sans-serif", fontWeight: 700, fontSize: 15, cursor: 'pointer',
              boxShadow: '0 5px 0 #2F5233',
            }}
          >Reload</button>
        </div>
      </div>
    );
  }
}
