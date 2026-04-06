export interface GrapeRankServiceConfig {
  port: number
  host: string
  serviceId: string
  pageSize: number
  verboseFeedback: boolean
}

export function loadConfig(): GrapeRankServiceConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    host: process.env['HOST'] ?? '127.0.0.1',
    serviceId: process.env['SERVICE_ID'] ?? 'graperank_wot',
    pageSize: parseInt(process.env['PAGE_SIZE'] ?? '1000', 10),
    verboseFeedback: process.env['VERBOSE_FEEDBACK'] === 'true',
  }
}
