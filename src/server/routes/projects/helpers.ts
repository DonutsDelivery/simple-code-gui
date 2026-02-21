/**
 * Project Routes - Response Helpers
 *
 * Shared helper functions for sending API responses.
 */

import { Response } from 'express'
import { ApiResponse } from '../../types.js'

export function sendResponse<T>(res: Response, statusCode: number, data: ApiResponse<T>): void {
  res.status(statusCode).json(data)
}

export function sendError(res: Response, statusCode: number, error: string): void {
  sendResponse(res, statusCode, {
    success: false,
    error,
    timestamp: Date.now()
  })
}
