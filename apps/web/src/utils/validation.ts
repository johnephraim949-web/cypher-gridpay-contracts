/* URL validation for webhook endpoints */

const PRIVATE_IP_RANGES: RegExp[] = [
  /^127\./,                                              // loopback
  /^169\.254\./,                                         // link-local metadata
  /^10\./,                                               // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[01])\./,                       // 172.16.0.0/12
  /^192\.168\./,                                         // 192.168.0.0/16
  /^::1$/,                                               // IPv6 loopback
  /^fc00:/,                                              // IPv6 unique local
  /^fe80:/,                                              // IPv6 link-local
]

export interface ValidationResult {
  valid: boolean
  error: string | null
}

export function isPrivateOrLoopbackIp(hostname: string): boolean {
  if (!hostname) return false
  const stripped = hostname.replace(/^\[|\]$/g, '')
  return PRIVATE_IP_RANGES.some((re) => re.test(stripped))
}

export function extractHostname(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return null
  }
}

export function validateWebhookUrl(url: string, options: { requireHttps?: boolean } = {}): ValidationResult {
  const { requireHttps = true } = options

  if (!url || url.trim().length === 0) {
    return { valid: false, error: 'Webhook URL is required' }
  }

  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  const protocol = parsed.protocol

  if (requireHttps && protocol !== 'https:') {
    return { valid: false, error: 'Production webhook URLs must use https://' }
  }

  if (!requireHttps && protocol !== 'http:' && protocol !== 'https:') {
    return { valid: false, error: 'URL must use http:// or https://' }
  }

  if (!parsed.hostname) {
    return { valid: false, error: 'URL must include a host' }
  }

  if (isPrivateOrLoopbackIp(parsed.hostname)) {
    return { valid: false, error: 'Private or loopback IP addresses are not allowed (SSRF protection)' }
  }

  return { valid: true, error: null }
}

/* Secret masking */

export function maskSecret(secret: string): string {
  if (!secret) return ''
  const visible = 4
  return '•'.repeat(Math.max(0, secret.length - visible)) + secret.slice(-visible)
}

export function isMaskedSecret(value: string): boolean {
  return value.startsWith('•') && !value.includes('abcdef')
}
