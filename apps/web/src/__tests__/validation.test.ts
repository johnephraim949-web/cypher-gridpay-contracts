import { describe, it, expect } from 'vitest'
import { validateWebhookUrl, isPrivateOrLoopbackIp, extractHostname } from '@/utils/validation'

describe('validateWebhookUrl', () => {
  it('accepts a valid https URL', () => {
    const result = validateWebhookUrl('https://merchant.example.com/webhooks')
    expect(result.valid).toBe(true)
    expect(result.error).toBeNull()
  })

  it('rejects http URLs in production (requireHttps default true)', () => {
    const result = validateWebhookUrl('http://merchant.example.com/webhooks')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('https://')
  })

  it('rejects URLs without a scheme', () => {
    const result = validateWebhookUrl('merchant.example.com/webhooks')
    expect(result.valid).toBe(false)
  })

  it('rejects empty URL', () => {
    const result = validateWebhookUrl('')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Webhook URL is required')
  })

  it('rejects loopback IP 127.0.0.1', () => {
    const result = validateWebhookUrl('https://127.0.0.1:8080/hooks')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SSRF')
  })

  it('rejects link-local metadata IP 169.254.169.254', () => {
    const result = validateWebhookUrl('https://169.254.169.254/latest/meta-data')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SSRF')
  })

  it('rejects private 10.x.x.x range', () => {
    const result = validateWebhookUrl('https://10.0.0.5/hooks')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('SSRF')
  })

  it('allows http when requireHttps is false', () => {
    const result = validateWebhookUrl('http://localhost:3000/hooks', { requireHttps: false })
    expect(result.valid).toBe(true)
  })

  it('rejects 172.16.0.0/12 and 192.168.0.0/16 private ranges', () => {
    expect(validateWebhookUrl('https://172.16.0.1/hooks', { requireHttps: false }).valid).toBe(false)
    expect(validateWebhookUrl('https://192.168.1.50/hooks', { requireHttps: false }).valid).toBe(false)
  })

  it('accepts public https IP when not private', () => {
    const result = validateWebhookUrl('https://93.184.216.34/hooks')
    expect(result.valid).toBe(true)
  })
})

describe('extractHostname', () => {
  it('extracts hostname from https URL', () => {
    expect(extractHostname('https://a.b.c/path')).toBe('a.b.c')
  })
  it('returns null for invalid input', () => {
    expect(extractHostname('not a url')).toBeNull()
  })
})

describe('isPrivateOrLoopbackIp', () => {
  it('flags loopback', () => {
    expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true)
  })
  it('flags metadata IP', () => {
    expect(isPrivateOrLoopbackIp('169.254.169.254')).toBe(true)
  })
  it('flags 10.x range', () => {
    expect(isPrivateOrLoopbackIp('10.255.255.255')).toBe(true)
  })
  it('does not flag public IP', () => {
    expect(isPrivateOrLoopbackIp('8.8.8.8')).toBe(false)
  })
})
