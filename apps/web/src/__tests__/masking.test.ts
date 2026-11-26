import { describe, it, expect } from 'vitest'
import { maskSecret } from '@/utils/validation'

describe('maskSecret', () => {
  it('masks all but the last 4 characters', () => {
    expect(maskSecret('abcdef1234567890')).toBe('••••••••••••7890')
  })

  it('handles short secrets by showing all', () => {
    expect(maskSecret('abcd')).toBe('abcd')
    expect(maskSecret('abc')).toBe('abc')
  })

  it('returns empty string for empty input', () => {
    expect(maskSecret('')).toBe('')
  })

  it('does not reveal the full secret in the masked output', () => {
    const secret = 'sk_live_0123456789abcdef'
    const masked = maskSecret(secret)
    expect(masked).not.toBe(secret)
    expect(masked.endsWith('cdef')).toBe(true)
    expect(masked.startsWith('•')).toBe(true)
  })
})
