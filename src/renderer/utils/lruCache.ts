/**
 * Simple LRU (Least Recently Used) cache implementation.
 * Evicts the least recently accessed entry when the cache exceeds maxSize.
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>
  private readonly maxSize: number

  constructor(maxSize: number = 50) {
    if (maxSize < 1) {
      throw new Error('LRU cache maxSize must be at least 1')
    }
    this.cache = new Map()
    this.maxSize = maxSize
  }

  /**
   * Get a value from the cache. Moves the entry to most recently used position.
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined
    }
    // Move to end (most recently used) by re-inserting
    const value = this.cache.get(key)!
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  /**
   * Set a value in the cache. Evicts LRU entry if cache exceeds maxSize.
   */
  set(key: K, value: V): void {
    // If key exists, delete first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict LRU entries if we're at capacity
    while (this.cache.size >= this.maxSize) {
      // Map iterator returns entries in insertion order, first is LRU
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, value)
  }

  /**
   * Check if key exists in cache (does not affect LRU order).
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * Delete a specific key from the cache.
   */
  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get all keys in the cache (in LRU order, least recent first).
   */
  keys(): IterableIterator<K> {
    return this.cache.keys()
  }
}

// Shared cache instances for project data - max 50 projects
const MAX_CACHED_PROJECTS = 50

export const tasksCache = new LRUCache<string, unknown[]>(MAX_CACHED_PROJECTS)
export const beadsStatusCache = new LRUCache<string, { installed: boolean; initialized: boolean }>(MAX_CACHED_PROJECTS)

/**
 * Clear all cached data for a specific project path.
 * Call this when a project is removed from the workspace.
 */
export function clearProjectCaches(projectPath: string): void {
  tasksCache.delete(projectPath)
  beadsStatusCache.delete(projectPath)
}
