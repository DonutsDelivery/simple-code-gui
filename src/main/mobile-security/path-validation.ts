/**
 * Path Validation Module
 *
 * Provides path sanitization and validation to prevent
 * path traversal attacks and access to sensitive directories.
 */

import { existsSync, statSync } from 'fs'
import { resolve, isAbsolute, normalize } from 'path'
import { homedir } from 'os'
import type { PathValidationResult, PathValidationOptions } from './types.js'

// Sensitive paths that should never be accessed
const BLOCKED_PATHS = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/proc',
  '/sys',
  '/dev',
  '/root',
  '/lib',
  '/lib64',
  // Windows system paths
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  // macOS system paths
  '/System',
  '/Library',
  '/private'
]

/**
 * Validate and sanitize a path parameter
 * Prevents path traversal attacks and access to sensitive directories
 */
export function validatePath(inputPath: string, options: PathValidationOptions = {}): PathValidationResult {
  // Check for empty or invalid input
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, error: 'Path is required and must be a string' }
  }

  // Trim whitespace
  const trimmedPath = inputPath.trim()
  if (trimmedPath.length === 0) {
    return { valid: false, error: 'Path cannot be empty' }
  }

  // Reject paths with null bytes (common injection technique)
  if (trimmedPath.includes('\0')) {
    return { valid: false, error: 'Path contains invalid characters' }
  }

  // Normalize the path to resolve . and .. segments
  let normalizedPath: string
  try {
    // If relative, resolve against home directory (safe default)
    if (!isAbsolute(trimmedPath)) {
      normalizedPath = resolve(homedir(), trimmedPath)
    } else {
      normalizedPath = resolve(trimmedPath)
    }
    normalizedPath = normalize(normalizedPath)
  } catch {
    return { valid: false, error: 'Invalid path format' }
  }

  // Check for path traversal attempts in the original input
  // Even after normalization, check if the original contained suspicious patterns
  if (trimmedPath.includes('..') && !normalizedPath.startsWith(resolve(trimmedPath.split('..')[0]))) {
    return { valid: false, error: 'Path traversal detected' }
  }

  // Check against blocked system paths
  const lowerPath = normalizedPath.toLowerCase()
  for (const blocked of BLOCKED_PATHS) {
    if (lowerPath.startsWith(blocked.toLowerCase())) {
      return { valid: false, error: 'Access to system directories is not allowed' }
    }
  }

  // If allowed base paths specified, verify path is under one of them
  if (options.allowedBasePaths && options.allowedBasePaths.length > 0) {
    const isUnderAllowed = options.allowedBasePaths.some(basePath => {
      const normalizedBase = normalize(resolve(basePath))
      return normalizedPath.startsWith(normalizedBase)
    })
    if (!isUnderAllowed) {
      return { valid: false, error: 'Path is not within allowed directories' }
    }
  }

  // Check existence if required
  if (options.mustExist) {
    if (!existsSync(normalizedPath)) {
      return { valid: false, error: 'Path does not exist' }
    }
  }

  // Check if directory/file if required
  if (options.mustBeDirectory === true) {
    try {
      const stats = statSync(normalizedPath)
      if (!stats.isDirectory()) {
        return { valid: false, error: 'Path must be a directory' }
      }
    } catch {
      return { valid: false, error: 'Unable to access path' }
    }
  } else if (options.mustBeDirectory === false) {
    // Explicitly false means must be a file
    try {
      const stats = statSync(normalizedPath)
      if (!stats.isFile()) {
        return { valid: false, error: 'Path must be a file' }
      }
    } catch {
      return { valid: false, error: 'Unable to access path' }
    }
  }

  return { valid: true, normalizedPath }
}

/**
 * Quick validation for project paths (cwd, projectPath parameters)
 * Must exist and be a directory
 */
export function validateProjectPath(path: string): PathValidationResult {
  return validatePath(path, {
    mustExist: true,
    mustBeDirectory: true
  })
}

/**
 * Validation for file paths (for file download/read operations)
 * Must exist and be a file (not directory)
 * Optionally constrain to specific base directories
 */
export function validateFilePath(path: string, allowedBasePaths?: string[]): PathValidationResult {
  return validatePath(path, {
    mustExist: true,
    mustBeDirectory: false, // Must be a file
    allowedBasePaths
  })
}

/**
 * Validation for directory listing paths
 * Must exist and be a directory
 * Optionally constrain to specific base directories
 */
export function validateDirectoryPath(path: string, allowedBasePaths?: string[]): PathValidationResult {
  return validatePath(path, {
    mustExist: true,
    mustBeDirectory: true,
    allowedBasePaths
  })
}
