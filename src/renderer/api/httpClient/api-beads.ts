/**
 * Beads API
 *
 * API methods for Beads task management.
 */

import { HostConfig } from '../hostConfig.js'
import { get, post, patch, del } from './http-helpers.js'
import type { BeadsTask, BeadsCloseResult } from './types.js'

/**
 * Check if Beads is installed and initialized
 */
export function beadsCheck(
  config: HostConfig,
  cwd: string
): Promise<{ installed: boolean; initialized: boolean }> {
  return get<{ installed: boolean; initialized: boolean }>(
    config,
    `/projects/beads/check?cwd=${encodeURIComponent(cwd)}`
  )
}

/**
 * Initialize Beads in a project
 */
export async function beadsInit(
  config: HostConfig,
  cwd: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await post(config, '/projects/beads/init', { cwd })
    return { success: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * List all Beads tasks
 */
export async function beadsList(
  config: HostConfig,
  cwd: string
): Promise<{ success: boolean; tasks?: BeadsTask[]; error?: string }> {
  try {
    const tasks = await get<BeadsTask[]>(
      config,
      `/projects/beads/tasks?cwd=${encodeURIComponent(cwd)}`
    )
    return { success: true, tasks }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Show a specific Beads task
 */
export async function beadsShow(
  config: HostConfig,
  cwd: string,
  taskId: string
): Promise<{ success: boolean; task?: BeadsTask; error?: string }> {
  try {
    const task = await get<BeadsTask>(
      config,
      `/projects/beads/tasks/${taskId}?cwd=${encodeURIComponent(cwd)}`
    )
    return { success: true, task }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Create a new Beads task
 */
export async function beadsCreate(
  config: HostConfig,
  cwd: string,
  title: string,
  description?: string,
  priority?: number,
  type?: string,
  labels?: string
): Promise<{ success: boolean; task?: BeadsTask; error?: string }> {
  try {
    const task = await post<BeadsTask>(config, '/projects/beads/tasks', {
      cwd,
      title,
      description,
      priority,
      type,
      labels
    })
    return { success: true, task }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Complete a Beads task
 */
export async function beadsComplete(
  config: HostConfig,
  cwd: string,
  taskId: string
): Promise<{ success: boolean; result?: BeadsCloseResult; error?: string }> {
  try {
    await post(config, `/projects/beads/tasks/${taskId}/complete`, { cwd })
    return { success: true, result: { taskId, status: 'completed' } }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Delete a Beads task
 */
export async function beadsDelete(
  config: HostConfig,
  cwd: string,
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await del(config, `/projects/beads/tasks/${taskId}?cwd=${encodeURIComponent(cwd)}`)
    return { success: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Start a Beads task
 */
export async function beadsStart(
  config: HostConfig,
  cwd: string,
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await post(config, `/projects/beads/tasks/${taskId}/start`, { cwd })
    return { success: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

/**
 * Update a Beads task
 */
export async function beadsUpdate(
  config: HostConfig,
  cwd: string,
  taskId: string,
  status?: string,
  title?: string,
  description?: string,
  priority?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await patch(config, `/projects/beads/tasks/${taskId}`, {
      cwd,
      status,
      title,
      description,
      priority
    })
    return { success: true }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}
