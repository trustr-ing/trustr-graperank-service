export interface GrapeRankServiceConfig {
  port: number
  host: string
  serviceId: string
  pageSize: number
  verboseFeedback: boolean
  fallbackReadRelays: string[]
  allowedRequestTypes: string[]
  defaultRequestType: string
  // The archive: a lake URL serving the derivation manifests and files
  // (nas-py docs/notes/lake-url-manifests.org). Absent: every interpreter
  // reads the relays.
  archiveUrl?: string
  archiveMemoryLimit: string
  archiveThreads?: number
}

function parseCommaSeparated(value?: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
}

export function loadConfig(): GrapeRankServiceConfig {
  const allowedRequestTypes = parseCommaSeparated(process.env['ALLOWED_REQUEST_TYPES'])
  const normalizedAllowedRequestTypes = allowedRequestTypes.length > 0
    ? allowedRequestTypes
    : ['pubkey', 'p', 'P']

  const configuredDefaultRequestType = process.env['DEFAULT_REQUEST_TYPE']?.trim()
  const defaultRequestType = configuredDefaultRequestType && normalizedAllowedRequestTypes.includes(configuredDefaultRequestType)
    ? configuredDefaultRequestType
    : (normalizedAllowedRequestTypes.includes('p') ? 'p' : normalizedAllowedRequestTypes[0])

  return {
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    host: process.env['HOST'] ?? '127.0.0.1',
    serviceId: process.env['SERVICE_ID'] ?? 'graperank_wot',
    pageSize: parseInt(process.env['PAGE_SIZE'] ?? '1000', 10),
    verboseFeedback: process.env['VERBOSE_FEEDBACK'] === 'true',
    fallbackReadRelays: parseCommaSeparated(process.env['READ_RELAYS']),
    allowedRequestTypes: normalizedAllowedRequestTypes,
    defaultRequestType,
    archiveUrl: process.env['ARCHIVE_URL']?.trim() || undefined,
    archiveMemoryLimit: process.env['ARCHIVE_MEMORY_LIMIT']?.trim() || '2GB',
    archiveThreads: process.env['ARCHIVE_THREADS'] ? parseInt(process.env['ARCHIVE_THREADS'], 10) : undefined,
  }
}
