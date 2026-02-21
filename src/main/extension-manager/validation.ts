import { spawn } from 'child_process'

// Safe spawn wrapper that returns a promise - prevents shell injection by using argument arrays
export function spawnAsync(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false,  // Critical: disable shell to prevent injection
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

// Validate GitHub repository URL to prevent injection
export function isValidGitHubUrl(url: string): boolean {
  // Only allow well-formed GitHub HTTPS URLs
  // Pattern: https://github.com/owner/repo or https://github.com/owner/repo.git
  const githubPattern = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/
  return githubPattern.test(url)
}

// Validate npm package name to prevent injection
export function isValidNpmPackageName(name: string): boolean {
  // npm package names: lowercase, may include @scope/, hyphens, dots, underscores
  // Must not contain shell metacharacters
  const npmPattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
  return npmPattern.test(name) && name.length <= 214
}
