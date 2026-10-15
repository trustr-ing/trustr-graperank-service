import Fastify from 'fastify'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { createLakeSource, setArchive } from '@graperank/tsm-graperank-library'
import type { LakeSource } from '@graperank/tsm-graperank-library'
import { loadConfig } from './config'
import { registerRoutes, getEventBuffer } from './routes/request'

// Inject ws into nostr-tools so SimplePool works in Node.js
// (the graperank-tsm library uses SimplePool to fetch events from relays)
useWebSocketImplementation(WebSocket)

async function main(): Promise<void> {
  const config = loadConfig()

  console.log(`[graperank-service] starting service "${config.serviceId}"`)

  // The archive, opened once: each interpreter reads it first when it holds
  // the interpreter's events and the request does not set liveNetwork; the
  // relays otherwise. The library tells which per interpreter, as feedback.
  let archive: LakeSource | undefined
  if (config.archiveUrl) {
    try {
      archive = await createLakeSource({
        url: config.archiveUrl,
        memoryLimit: config.archiveMemoryLimit,
        threads: config.archiveThreads,
      })
      setArchive(archive)
      console.log(`[graperank-service] archive: ${archive.describe()}`)
    } catch (err) {
      console.error(`[graperank-service] archive at ${config.archiveUrl} not opened, every interpreter reads the relays:`, (err as Error).message)
    }
  } else {
    console.log('[graperank-service] no ARCHIVE_URL: every interpreter reads the relays')
  }

  const app = Fastify({ logger: false })

  registerRoutes(app, config, archive)

  try {
    await app.listen({ port: config.port, host: config.host })
    console.log(`[graperank-service] listening on http://${config.host}:${config.port}`)
  } catch (err) {
    console.error('[graperank-service] failed to start:', err)
    process.exit(1)
  }

  const shutdown = async (): Promise<void> => {
    console.log('[graperank-service] shutting down...')
    await app.close()
    getEventBuffer().close()
    await archive?.close()
    console.log('[graperank-service] cleanup complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch(err => {
  console.error('[graperank-service] fatal error:', err)
  process.exit(1)
})
