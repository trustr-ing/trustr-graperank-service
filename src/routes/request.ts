import { FastifyInstance } from 'fastify'
import {
  parseServiceRequest,
  ServiceRequestParseError,
  executeServiceRequest,
  generateServiceAnnouncement,
} from '@graperank/tsm-graperank-library'
import type { UnsignedEvent } from '@graperank/tsm-graperank-library'
import type { GrapeRankServiceConfig } from '../config'

interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

interface RequestBody {
  event: NostrEvent
  serviceId: string
}

export function registerRoutes(
  app: FastifyInstance,
  config: GrapeRankServiceConfig,
): void {
  app.get('/tsm/announce', async (_req, reply) => {
    const announcement = generateServiceAnnouncement({
      identifier: config.serviceId,
      title: 'Trustr Graperank Service',
      summary: 'Rank Nostr users and content by follows, mutes, reports, zaps, attestation, and other interactions.',
      pagination: true,
    })
    return reply.send(announcement)
  })

  app.post<{ Body: RequestBody }>('/tsm/request', async (req, reply) => {
    const { event, serviceId } = req.body

    if (!event || typeof event !== 'object') {
      return reply.status(400).send({ error: 'Missing or invalid event' })
    }

    const logPrefix = `[request:${event.id.slice(0, 8)}...]`

    // Parse the request before starting the stream
    let parsedRequest
    try {
      parsedRequest = parseServiceRequest(event)
    } catch (err) {
      const message = err instanceof ServiceRequestParseError
        ? `Parse error (${err.field ?? 'unknown'}): ${err.message}`
        : `Unexpected parse error: ${(err as Error).message}`

      console.error(`${logPrefix} ${message}`)

      // Send parse error as a single SSE feedback event, then close
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      const errorEvent = buildFeedbackEvent(event, 'error', message)
      reply.raw.write(`data: ${JSON.stringify(errorEvent)}\n\n`)
      reply.raw.end()
      return
    }

    console.log(`${logPrefix} starting GrapeRank for pov=${JSON.stringify(parsedRequest.configs.pov)}`)

    // Hijack Fastify response to stream SSE
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const sendEvent = (unsignedEvent: UnsignedEvent): void => {
      reply.raw.write(`data: ${JSON.stringify(unsignedEvent)}\n\n`)
    }

    try {
      await executeServiceRequest({
        requestEvent: event,
        parsedRequest,
        pageSize: config.pageSize,
        verboseFeedback: config.verboseFeedback,
        callbacks: {
          onFeedbackEvent: sendEvent,
          onOutputEvent: sendEvent,
        },
      })
      console.log(`${logPrefix} completed successfully`)
    } catch (err) {
      const message = (err as Error).message
      console.error(`${logPrefix} execution error: ${message}`)
      sendEvent(buildFeedbackEvent(event, 'error', `Execution error: ${message}`))
    } finally {
      reply.raw.end()
    }
  })

  app.get('/health', async (_req, reply) => {
    reply.status(200).send({ status: 'ok', serviceId: config.serviceId })
  })
}

function buildFeedbackEvent(
  requestEvent: NostrEvent,
  status: 'info' | 'warning' | 'error' | 'success',
  message: string,
): UnsignedEvent {
  return {
    kind: 7000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', requestEvent.id, '', 'request'],
      ['p', requestEvent.pubkey],
      ['k', String(requestEvent.kind)],
      ['status', status],
    ],
    content: message,
  }
}
