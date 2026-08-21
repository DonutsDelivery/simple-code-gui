import { describe, expect, it } from 'vitest'
import { isFrontendOnlyLaunch } from './AppConnection'

describe('desktop launch mode', () => {
  it('uses the embedded local server for an ordinary desktop restart', () => {
    localStorage.setItem('donutcode-frontend-only', '1')

    expect(isFrontendOnlyLaunch(false, '')).toBe(false)
  })

  it('keeps explicit frontend-only launch modes', () => {
    expect(isFrontendOnlyLaunch(true, '')).toBe(true)
    expect(isFrontendOnlyLaunch(false, '?frontendOnly=1')).toBe(true)
  })
})
