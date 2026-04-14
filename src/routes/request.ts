import { FastifyInstance } from 'fastify'
import {
  parseServiceRequest,
  ServiceRequestParseError,
  executeServiceRequest,
  generateServiceAnnouncement,
  NostrInterpreterClass,
} from '@graperank/tsm-graperank-library'
import type { UnsignedEvent } from '@graperank/tsm-graperank-library'
import type { GrapeRankServiceConfig } from '../config'
import { RequestEventBuffer } from '../buffer/RequestEventBuffer'

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

const eventBuffer = new RequestEventBuffer()

export function getEventBuffer(): RequestEventBuffer {
  return eventBuffer
}

export function registerRoutes(
  app: FastifyInstance,
  config: GrapeRankServiceConfig,
): void {
  NostrInterpreterClass.relays = [
    'ws://10.118.0.4:8080',
    'wss://relay.primal.net',
    'wss://relay.damus.io',
  ]
  console.log('[graperank-service] NostrInterpreterClass.relays set to:', NostrInterpreterClass.relays)

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
      eventBuffer.addEvent(event.id, unsignedEvent)
      reply.raw.write(`data: ${JSON.stringify(unsignedEvent)}\n\n`)
    }

    const sendKeepAlive = (): void => {
      reply.raw.write(': keep-alive\n\n')
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
          onKeepAlive: sendKeepAlive,
        },
      })
      console.log(`${logPrefix} completed successfully`)
      eventBuffer.markCompleted(event.id)
    } catch (err) {
      const message = (err as Error).message
      console.error(`${logPrefix} execution error: ${message}`)
      sendEvent(buildFeedbackEvent(event, 'error', `Execution error: ${message}`))
      eventBuffer.markCompleted(event.id)
    } finally {
      reply.raw.end()
    }
  })

  app.get<{ Params: { requestId: string }, Querystring: { cursor?: string } }>(
    '/tsm/request/:requestId/events',
    async (req, reply) => {
      const { requestId } = req.params
      const cursor = parseInt(req.query.cursor || '0', 10)

      const status = eventBuffer.getStatus(requestId)
      if (!status) {
        return reply.status(404).send({ error: 'Request not found or expired' })
      }

      const events = eventBuffer.getEvents(requestId, cursor)

      return reply.send({
        requestId,
        events,
        cursor: cursor + events.length,
        completed: status.completed,
        totalEvents: status.eventCount,
        hasMore: cursor + events.length < status.eventCount,
      })
    }
  )

  app.get('/health', async (_req, reply) => {
    reply.status(200).send({ status: 'ok', serviceId: config.serviceId })
  })
}

function buildFeedbackEvent(
  requestEvent: NostrEvent,
  status: 'info' | 'warning' | 'error' | 'success',
  message: string,
  metrics?: any,
): UnsignedEvent {
  const tags: string[][] = [
    ['e', requestEvent.id, '', 'request'],
    ['p', requestEvent.pubkey],
    ['k', String(requestEvent.kind)],
    ['status', status],
  ]

  // Add structured metrics as a tag if provided
  if (metrics) {
    tags.push(['metrics', JSON.stringify(metrics)])
  }

  return {
    kind: 7000,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: message,
  }
}
