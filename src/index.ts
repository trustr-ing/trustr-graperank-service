import Fastify from 'fastify'
import WebSocket from 'ws'
import { useWebSocketImplementation } from 'nostr-tools/pool'
import { configureRelayFetch } from '@graperank/tsm-graperank-library'
import { loadConfig } from './config'
import { registerRoutes, getEventBuffer } from './routes/request'

// Inject ws into nostr-tools so SimplePool works in Node.js
// (the graperank-tsm library uses SimplePool to fetch events from relays)
useWebSocketImplementation(WebSocket)

async function main(): Promise<void> {
  const config = loadConfig()

  console.log(`[graperank-service] starting service "${config.serviceId}"`)

  // Tell the library which relays are on our private network (no politeness
  // delay, no straggler wait) and any fetch timing overrides. The library
  // itself assumes nothing about TrustR's relays.
  const fetchConfig = configureRelayFetch({
    localRelays: config.localReadRelays,
    eoseGraceMs: config.fetchEoseGraceMs,
    interFetchDelayMs: config.fetchInterDelayMs,
    absoluteTimeoutMs: config.fetchAbsoluteTimeoutMs,
  })
  console.log('[graperank-service] relay fetch config:', fetchConfig)

  const app = Fastify({ logger: false })

  registerRoutes(app, config)

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
