/**
 * Styles for ConnectionScreen components
 */

export const connectionScreenStyles = `
  .connection-form {
    width: 100%;
    max-width: 300px;
    margin-top: 16px;
  }

  .form-group {
    margin-bottom: 16px;
    text-align: left;
  }

  .form-group label {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    opacity: 0.8;
  }

  .form-group input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border-color, #444);
    border-radius: 8px;
    background: var(--input-bg, #1a1a1a);
    color: var(--text-color, #fff);
    font-size: 14px;
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--accent-color, #007aff);
  }

  .mobile-btn-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 300px;
    margin-top: 16px;
  }

  .mobile-btn {
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    background: var(--accent-color, #007aff);
    color: #fff;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .mobile-btn:hover {
    background: var(--accent-hover, #0056b3);
  }

  .mobile-btn--secondary {
    background: transparent;
    border: 1px solid var(--border-color, #444);
    color: var(--text-color, #fff);
  }

  .mobile-btn--secondary:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .mobile-logo {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.8;
  }

  .mobile-logo--error {
    color: #ef4444;
  }

  .mobile-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: var(--accent-color, #007aff);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-top: 16px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .install-note {
    margin-top: 24px;
    font-size: 12px;
    opacity: 0.6;
  }

  .connection-details {
    font-size: 12px;
    opacity: 0.7;
    margin: 8px 0;
    font-family: monospace;
  }

  .saved-hosts-section {
    width: 100%;
    max-width: 300px;
    margin: 16px 0;
  }

  .saved-hosts-title {
    font-size: 12px;
    opacity: 0.7;
    margin-bottom: 8px;
    text-align: left;
  }

  .saved-hosts-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .saved-host-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--input-bg, #1a1a1a);
    border: 1px solid var(--border-color, #444);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }

  .saved-host-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--accent-color, #007aff);
  }

  .saved-host-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .saved-host-name {
    font-size: 14px;
    font-family: monospace;
  }

  .saved-host-last {
    font-size: 11px;
    opacity: 0.5;
  }

  .saved-host-remove {
    background: transparent;
    border: none;
    color: var(--text-color, #fff);
    opacity: 0.4;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    transition: opacity 0.2s;
  }

  .saved-host-remove:hover {
    opacity: 1;
    color: #ef4444;
  }
`
