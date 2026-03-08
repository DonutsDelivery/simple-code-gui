export type {
  UnifiedTask,
  TaskStatus,
  TaskType,
  CreateTaskParams,
  UpdateTaskParams,
  BackendKind,
  BackendStatus,
  TaskAdapter
} from './types.js'

export { BeadsAdapter } from './beads-adapter.js'
export { KspecAdapter } from './kspec-adapter.js'
export { detectBackend, getAdapter, getAdapterForProject, beadsAdapter, kspecAdapter } from './detect.js'
