import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, lstatSync, readlinkSync, unlinkSync, rmSync, symlinkSync } from 'fs'
import { join, basename } from 'path'
import type { Workspace, Project, ProjectCategory } from './session-store'

const UNCATEGORIZED_FOLDER = 'Uncategorized'

/**
 * Get the base path for meta-projects symlink structure
 */
function getMetaProjectsBasePath(): string {
  return join(app.getPath('userData'), 'meta-projects')
}

/**
 * Safely remove a directory and all its contents
 * Meta-projects dir only contains our symlinks/structure, so safe to fully remove
 */
function removeSymlinkDirectory(dirPath: string): void {
  if (!existsSync(dirPath)) return

  try {
    rmSync(dirPath, { recursive: true, force: true })
  } catch (e) {
    console.warn(`Failed to remove directory ${dirPath}:`, e)
  }
}

/**
 * Clear all existing symlinks and category folders
 */
function clearMetaProjects(basePath: string): void {
  if (!existsSync(basePath)) return

  try {
    const entries = readdirSync(basePath)
    for (const entry of entries) {
      const entryPath = join(basePath, entry)
      const stat = lstatSync(entryPath)

      if (stat.isSymbolicLink()) {
        unlinkSync(entryPath)
      } else if (stat.isDirectory()) {
        removeSymlinkDirectory(entryPath)
      }
    }
  } catch (e) {
    console.warn('Failed to clear meta-projects:', e)
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

  // Clear existing structure (full rebuild approach - simple and safe)
  clearMetaProjects(basePath)

  // Build category mapping
  const categoryMap = buildCategoryMap(workspace.categories)

  // Group projects by category
  const projectGroups = groupProjectsByCategory(workspace.projects, categoryMap)

  // Create category directories and symlinks
  for (const [categoryName, projects] of projectGroups) {
    const categoryDir = join(basePath, categoryName)

    // Create category directory
    try {
      mkdirSync(categoryDir, { recursive: true })
    } catch (e) {
      console.warn(`Failed to create category directory ${categoryDir}:`, e)
      continue
    }

    // Track used names within this category for collision handling
    const usedNames = new Set<string>()

    // Create symlinks for each project
    for (const project of projects) {
      const symlinkName = getUniqueSymlinkName(categoryDir, project.name, usedNames)
      const symlinkPath = join(categoryDir, symlinkName)

      createSymlink(project.path, symlinkPath)
    }
  }
}

/**
 * Get the meta-projects path (exported for use by other modules if needed)
 */
export function getMetaProjectsPath(): string {
  return getMetaProjectsBasePath()
}
