import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, lstatSync, readlinkSync, unlinkSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import type { Workspace, Project, ProjectCategory } from './session-store'

const UNCATEGORIZED_FOLDER = 'Uncategorized'

/**
 * Get the base path for meta-projects symlink structure
 */
function getMetaProjectsBasePath(): string {
  return join(app.getPath('userData'), 'meta-projects')
}

/**
 * Get current symlinks in a category directory
 * Returns map of symlink name -> target path
 */
function getCurrentSymlinks(categoryDir: string): Map<string, string> {
  const symlinks = new Map<string, string>()
  if (!existsSync(categoryDir)) return symlinks

  try {
    const entries = readdirSync(categoryDir)
    for (const entry of entries) {
      const entryPath = join(categoryDir, entry)
      try {
        const stat = lstatSync(entryPath)
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(entryPath)
          symlinks.set(entry, target)
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch {
    // Directory might not exist or be readable
  }
  return symlinks
}

/**
 * Remove a single symlink
 */
function removeSymlink(symlinkPath: string): void {
  try {
    if (existsSync(symlinkPath)) {
      const stat = lstatSync(symlinkPath)
      if (stat.isSymbolicLink()) {
        unlinkSync(symlinkPath)
      }
    }
  } catch (e) {
    console.warn(`Failed to remove symlink ${symlinkPath}:`, e)
  }
}

/**
 * Remove an empty category directory (only if it's empty)
 */
function removeEmptyCategoryDir(categoryDir: string): void {
  if (!existsSync(categoryDir)) return

  try {
    const entries = readdirSync(categoryDir)
    if (entries.length === 0) {
      rmSync(categoryDir, { recursive: true, force: true })
    }
  } catch (e) {
    console.warn(`Failed to remove empty category dir ${categoryDir}:`, e)
  }
}

/**
 * Generate a unique symlink name by appending numbers if needed
 */
function getUniqueSymlinkName(dir: string, baseName: string, existingNames: Set<string>): string {
  // Sanitize name for filesystem
  let name = baseName.replace(/[/\\:*?"<>|]/g, '_')

  if (!existingNames.has(name)) {
    existingNames.add(name)
    return name
  }

  // Append numbers until unique
  let counter = 2
  while (existingNames.has(`${name}-${counter}`)) {
    counter++
  }

  const uniqueName = `${name}-${counter}`
  existingNames.add(uniqueName)
  return uniqueName
}

/**
 * Create a symlink, handling errors gracefully
 */
function createSymlink(targetPath: string, symlinkPath: string): boolean {
  try {
    // Verify target path exists
    if (!existsSync(targetPath)) {
      console.warn(`Skipping symlink for non-existent path: ${targetPath}`)
      return false
    }

    symlinkSync(targetPath, symlinkPath)
    return true
  } catch (e) {
    console.warn(`Failed to create symlink ${symlinkPath} -> ${targetPath}:`, e)
    return false
  }
}

/**
 * Build category map from workspace
 */
function buildCategoryMap(categories: ProjectCategory[] | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (categories) {
    for (const cat of categories) {
      map.set(cat.id, cat.name)
    }
  }
  return map
}

/**
 * Group projects by category
 */
function groupProjectsByCategory(
  projects: Project[],
  categoryMap: Map<string, string>
): Map<string, Project[]> {
  const groups = new Map<string, Project[]>()

  for (const project of projects) {
    let categoryName: string

    if (project.categoryId && categoryMap.has(project.categoryId)) {
      categoryName = categoryMap.get(project.categoryId)!
    } else {
      categoryName = UNCATEGORIZED_FOLDER
    }

    // Sanitize category name for filesystem
    categoryName = categoryName.replace(/[/\\:*?"<>|]/g, '_')

    if (!groups.has(categoryName)) {
      groups.set(categoryName, [])
    }
    groups.get(categoryName)!.push(project)
  }

  return groups
}

/**
 * Sync workspace projects to meta-projects symlink structure
 *
 * Creates a hierarchical symlink structure mirroring workspace categories:
 * ~/.config/simple-code-gui/meta-projects/
 * ├── Work/
 * │   ├── ProjectA -> /home/user/work/ProjectA
 * │   └── ProjectB -> /home/user/work/ProjectB
 * ├── Personal/
 * │   └── MyApp -> /home/user/Projects/MyApp
 * └── Uncategorized/
 *     └── RandomProject -> /home/user/RandomProject
 *
 * IMPORTANT: This function does incremental updates to avoid breaking
 * running sessions that have their cwd in a category folder. It only
 * removes/adds symlinks as needed rather than deleting entire directories.
 */
export function syncMetaProjects(workspace: Workspace): void {
  const basePath = getMetaProjectsBasePath()

  // Ensure base directory exists
  if (!existsSync(basePath)) {
    try {
      mkdirSync(basePath, { recursive: true })
    } catch (e) {
      console.error('Failed to create meta-projects directory:', e)
      return
    }
  }

  // Build category mapping
  const categoryMap = buildCategoryMap(workspace.categories)

  // Group projects by category
  const projectGroups = groupProjectsByCategory(workspace.projects, categoryMap)

  // Track which category dirs should exist
  const expectedCategoryDirs = new Set<string>()
  for (const categoryName of projectGroups.keys()) {
    expectedCategoryDirs.add(categoryName)
  }

  // Process each category - add/update symlinks
  for (const [categoryName, projects] of projectGroups) {
    const categoryDir = join(basePath, categoryName)

    // Create category directory if it doesn't exist
    if (!existsSync(categoryDir)) {
      try {
        mkdirSync(categoryDir, { recursive: true })
      } catch (e) {
        console.warn(`Failed to create category directory ${categoryDir}:`, e)
        continue
      }
    }

    // Get current symlinks in this category
    const currentSymlinks = getCurrentSymlinks(categoryDir)

    // Build map of what symlinks should exist (project path -> desired symlink name)
    const desiredSymlinks = new Map<string, string>()
    const usedNames = new Set<string>()

    for (const project of projects) {
      const symlinkName = getUniqueSymlinkName(categoryDir, project.name, usedNames)
      desiredSymlinks.set(project.path, symlinkName)
    }

    // Remove symlinks that shouldn't exist or point to wrong targets
    for (const [name, target] of currentSymlinks) {
      // Check if this symlink is still needed
      let shouldKeep = false
      for (const [projectPath, desiredName] of desiredSymlinks) {
        if (target === projectPath && name === desiredName) {
          shouldKeep = true
          break
        }
      }
      if (!shouldKeep) {
        removeSymlink(join(categoryDir, name))
      }
    }

    // Refresh current symlinks after removals
    const remainingSymlinks = getCurrentSymlinks(categoryDir)
    const existingTargets = new Set(remainingSymlinks.values())

    // Create new symlinks that don't exist yet
    for (const [projectPath, symlinkName] of desiredSymlinks) {
      if (!existingTargets.has(projectPath)) {
        createSymlink(projectPath, join(categoryDir, symlinkName))
      }
    }
  }

  // Remove category directories that shouldn't exist anymore
  // But only remove symlinks inside, keep the directory if it still has content
  try {
    const existingDirs = readdirSync(basePath)
    for (const dirName of existingDirs) {
      if (!expectedCategoryDirs.has(dirName)) {
        const dirPath = join(basePath, dirName)
        const stat = lstatSync(dirPath)
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          // Remove all symlinks in this directory
          const symlinks = getCurrentSymlinks(dirPath)
          for (const name of symlinks.keys()) {
            removeSymlink(join(dirPath, name))
          }
          // Try to remove directory if empty
          removeEmptyCategoryDir(dirPath)
        }
      }
    }
  } catch (e) {
    console.warn('Failed to clean up old category directories:', e)
  }
}

/**
 * Get the meta-projects path (exported for use by other modules if needed)
 */
export function getMetaProjectsPath(): string {
  return getMetaProjectsBasePath()
}
