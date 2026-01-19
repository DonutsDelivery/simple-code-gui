// Re-export from the terminal module
// This file maintains backward compatibility with existing imports
export { Terminal, clearTerminalBuffer, cleanupOrphanedBuffers } from './terminal/index.js'
export type { TerminalProps, AutoWorkOptions } from './terminal/types.js'
