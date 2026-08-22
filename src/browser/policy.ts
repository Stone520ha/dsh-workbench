export interface BrowserPolicyOptions {
  allowedDomains?: readonly string[]
  prohibitedDomains?: readonly string[]
}

export class BrowserPolicy {
  private readonly allowed: string[]
  private readonly prohibited: string[]
  constructor(options: BrowserPolicyOptions = {}) {
    this.allowed = [...(options.allowedDomains ?? [])].map(normalizeDomain)
    this.prohibited = [...(options.prohibitedDomains ?? [])].map(normalizeDomain)
  }

  assertUrl(raw: string): URL {
    if (raw === 'about:blank') return new URL('about:blank')
    let url: URL
    try { url = new URL(raw) } catch { throw codedError('BROWSER_INVALID_URL', `Invalid URL: ${raw}`) }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw codedError('BROWSER_SCHEME_DENIED', `Browser navigation scheme is not allowed: ${url.protocol}`)
    }
    const host = url.hostname.toLowerCase()
    if (this.prohibited.some(domain => matchesDomain(host, domain))) {
      throw codedError('BROWSER_DOMAIN_DENIED', `Browser domain is prohibited: ${host}`)
    }
    if (this.allowed.length > 0 && !this.allowed.some(domain => matchesDomain(host, domain))) {
      throw codedError('BROWSER_DOMAIN_DENIED', `Browser domain is outside the allowlist: ${host}`)
    }
    return url
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}
function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '')
}
function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}
