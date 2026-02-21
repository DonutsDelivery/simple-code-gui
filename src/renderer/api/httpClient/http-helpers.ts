/**
 * HTTP Request Helpers
 *
 * Base HTTP methods for making authenticated API requests.
 */

import { HostConfig, buildApiUrl } from '../hostConfig.js'
import type { ApiResponse } from './types.js'

/**
 * Make an authenticated HTTP request
 */
export async function request<T>(
  config: HostConfig,
  method: string,
  endpoint: string,
  body?: unknown
): Promise<T> {
  const url = buildApiUrl(config, endpoint)

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.token}`
  }

  const options: RequestInit = {
    method,
    headers
  }

  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  const data: ApiResponse<T> = await response.json()

  if (!data.success) {
    throw new Error(data.error || `HTTP ${response.status}: Request failed`)
  }

  return data.data as T
}

/**
 * Make a GET request
 */
export function get<T>(config: HostConfig, endpoint: string): Promise<T> {
  return request<T>(config, 'GET', endpoint)
}

/**
 * Make a POST request
 */
export function post<T>(config: HostConfig, endpoint: string, body?: unknown): Promise<T> {
  return request<T>(config, 'POST', endpoint, body)
}

/**
 * Make a PUT request
 */
export function put<T>(config: HostConfig, endpoint: string, body?: unknown): Promise<T> {
  return request<T>(config, 'PUT', endpoint, body)
}

/**
 * Make a PATCH request
 */
export function patch<T>(config: HostConfig, endpoint: string, body?: unknown): Promise<T> {
  return request<T>(config, 'PATCH', endpoint, body)
}

/**
 * Make a DELETE request
 */
export function del<T>(config: HostConfig, endpoint: string): Promise<T> {
  return request<T>(config, 'DELETE', endpoint)
}
