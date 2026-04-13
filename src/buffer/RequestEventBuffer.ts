import Database from 'better-sqlite3'
import type { UnsignedEvent } from '@graperank/tsm-graperank-library'

interface BufferedRequestStatus {
  requestId: string
  completed: boolean
  completedAt: number | null
  eventCount: number
  lastActivity: number
}

const CLEANUP_INTERVAL_MS = 60_000
const COMPLETED_REQUEST_TTL_MS = 600_000

export class RequestEventBuffer {
  private db: Database.Database
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.initializeSchema()
    this.startCleanup()
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS buffered_events (
        request_id TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (request_id, event_index)
      );

      CREATE TABLE IF NOT EXISTS request_status (
        request_id TEXT PRIMARY KEY,
        completed INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER,
        event_count INTEGER NOT NULL DEFAULT 0,
        last_activity INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_completed_at 
        ON request_status(completed, completed_at);
    `)
  }

  addEvent(requestId: string, event: UnsignedEvent): void {
    const now = Date.now()
    const eventJson = JSON.stringify(event)

    this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO request_status 
        (request_id, last_activity, event_count) 
        VALUES (?, ?, 0)
      `).run(requestId, now)

      const { event_count } = this.db.prepare(`
        SELECT event_count FROM request_status WHERE request_id = ?
      `).get(requestId) as { event_count: number }

      this.db.prepare(`
        INSERT INTO buffered_events 
        (request_id, event_index, event_json, created_at) 
        VALUES (?, ?, ?, ?)
      `).run(requestId, event_count, eventJson, now)

      this.db.prepare(`
        UPDATE request_status 
        SET event_count = event_count + 1, last_activity = ? 
        WHERE request_id = ?
      `).run(now, requestId)
    })()
  }

  getEvents(requestId: string, fromIndex: number = 0): UnsignedEvent[] {
    const rows = this.db.prepare(`
      SELECT event_json 
      FROM buffered_events 
      WHERE request_id = ? AND event_index >= ?
      ORDER BY event_index ASC
    `).all(requestId, fromIndex) as { event_json: string }[]

    return rows.map(row => JSON.parse(row.event_json))
  }

  getStatus(requestId: string): BufferedRequestStatus | null {
    const row = this.db.prepare(`
      SELECT request_id, completed, completed_at, event_count, last_activity
      FROM request_status
      WHERE request_id = ?
    `).get(requestId) as {
      request_id: string
      completed: number
      completed_at: number | null
      event_count: number
      last_activity: number
    } | undefined

    if (!row) return null

    return {
      requestId: row.request_id,
      completed: row.completed === 1,
      completedAt: row.completed_at,
      eventCount: row.event_count,
      lastActivity: row.last_activity,
    }
  }

  markCompleted(requestId: string): void {
    const now = Date.now()
    this.db.prepare(`
      UPDATE request_status 
      SET completed = 1, completed_at = ?, last_activity = ?
      WHERE request_id = ?
    `).run(now, now, requestId)
  }

  cleanup(): void {
    const cutoff = Date.now() - COMPLETED_REQUEST_TTL_MS
    
    const deleted = this.db.transaction(() => {
      const requestIds = this.db.prepare(`
        SELECT request_id 
        FROM request_status 
        WHERE completed = 1 AND completed_at < ?
      `).all(cutoff) as { request_id: string }[]

      if (requestIds.length === 0) return 0

      const placeholders = requestIds.map(() => '?').join(',')
      const ids = requestIds.map(r => r.request_id)

      this.db.prepare(`
        DELETE FROM buffered_events 
        WHERE request_id IN (${placeholders})
      `).run(...ids)

      this.db.prepare(`
        DELETE FROM request_status 
        WHERE request_id IN (${placeholders})
      `).run(...ids)

      return requestIds.length
    })()

    if (deleted > 0) {
      console.log(`[buffer] cleaned up ${deleted} completed request(s)`)
    }
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, CLEANUP_INTERVAL_MS)
  }

  close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.db.close()
  }
}
