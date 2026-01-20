/**
 * MobileKeyboard Component
 *
 * Virtual keyboard for mobile devices providing essential keys
 * that aren't available on phone keyboards:
 * - Arrow keys (for Claude's option selection)
 * - Tab key
 * - Escape key
 * - Ctrl+C for interrupt
 */

import React, { useCallback, useState } from 'react'

interface MobileKeyboardProps {
  onKey: (key: string) => void
}

export function MobileKeyboard({ onKey }: MobileKeyboardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true)

  const sendKey = useCallback((key: string) => {
    onKey(key)
  }, [onKey])

  // Arrow key codes
  const ARROW_UP = '\x1b[A'
  const ARROW_DOWN = '\x1b[B'
  const ARROW_LEFT = '\x1b[D'
  const ARROW_RIGHT = '\x1b[C'
  const ENTER = '\r'
  const ESCAPE = '\x1b'
  const TAB = '\t'
  const CTRL_C = '\x03'

  if (!expanded) {
    return (
      <div className="mobile-keyboard mobile-keyboard--collapsed">
        <button
          className="mobile-keyboard-toggle"
          onClick={() => setExpanded(true)}
          title="Show keyboard"
        >
          <span className="mobile-keyboard-toggle-icon">⌨</span>
        </button>
      </div>
    )
  }

  return (
    <div className="mobile-keyboard">
      <button
        className="mobile-keyboard-toggle"
        onClick={() => setExpanded(false)}
        title="Hide keyboard"
      >
        <span className="mobile-keyboard-toggle-icon">×</span>
      </button>

      <div className="mobile-keyboard-row">
        <button
          className="mobile-key mobile-key--special"
          onClick={() => sendKey(ESCAPE)}
          title="Escape"
        >
          Esc
        </button>
        <button
          className="mobile-key mobile-key--special"
          onClick={() => sendKey(TAB)}
          title="Tab"
        >
          Tab
        </button>
        <button
          className="mobile-key mobile-key--special mobile-key--danger"
          onClick={() => sendKey(CTRL_C)}
          title="Ctrl+C (Interrupt)"
        >
          ^C
        </button>
      </div>

      <div className="mobile-keyboard-row mobile-keyboard-arrows">
        <div className="mobile-keyboard-arrow-pad">
          <button
            className="mobile-key mobile-key--arrow mobile-key--up"
            onClick={() => sendKey(ARROW_UP)}
            title="Arrow Up"
          >
            ▲
          </button>
          <div className="mobile-keyboard-arrow-middle">
            <button
              className="mobile-key mobile-key--arrow mobile-key--left"
              onClick={() => sendKey(ARROW_LEFT)}
              title="Arrow Left"
            >
              ◀
            </button>
            <button
              className="mobile-key mobile-key--arrow mobile-key--down"
              onClick={() => sendKey(ARROW_DOWN)}
              title="Arrow Down"
            >
              ▼
            </button>
            <button
              className="mobile-key mobile-key--arrow mobile-key--right"
              onClick={() => sendKey(ARROW_RIGHT)}
              title="Arrow Right"
            >
              ▶
            </button>
          </div>
        </div>
        <button
          className="mobile-key mobile-key--enter"
          onClick={() => sendKey(ENTER)}
          title="Enter"
        >
          Enter ↵
        </button>
      </div>
    </div>
  )
}

export default MobileKeyboard
