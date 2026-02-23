import type { Memory, Message, SearchOptions, SearchResult } from "clawkit:types";
import pg from "pg";

const { Pool } = pg;

export interface PostgresMemoryConfig {
  name?: string;
  connectionString?: string;
  tableName?: string;
}

export default function createPostgresMemory(config: PostgresMemoryConfig): Memory {
  const connectionString = config.connectionString || process.env.DATABASE_URL || "";
  const tableName = config.tableName ?? "clawkit_messages";
  let pool: InstanceType<typeof Pool>;

  return {
    name: "memory-postgres",

    async init() {
      pool = new Pool({ connectionString });

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${tableName}_session ON ${tableName}(session_id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_${tableName}_tsv ON ${tableName} USING GIN(tsv)
      `);
    },

    async saveMessages(sessionId: string, messages: Message[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const msg of messages) {
          const ts = (msg.timestamp ?? new Date()).toISOString();
          await client.query(
            `INSERT INTO ${tableName} (session_id, role, content, timestamp) VALUES ($1, $2, $3, $4)`,
            [sessionId, msg.role, msg.content, ts],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async loadMessages(sessionId: string, limit = 50): Promise<Message[]> {
      const result = await pool.query(
        `SELECT role, content, timestamp FROM ${tableName}
         WHERE session_id = $1 ORDER BY id DESC LIMIT $2`,
        [sessionId, limit],
      );

      return result.rows.reverse().map((r: any) => ({
        role: r.role as Message["role"],
        content: r.content,
        timestamp: new Date(r.timestamp),
      }));
    },

    async clear(sessionId: string) {
      await pool.query(`DELETE FROM ${tableName} WHERE session_id = $1`, [sessionId]);
    },

    async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
      const limit = options?.limit ?? 5;
      const terms = query.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
      if (terms.length === 0) return [];

      const tsQuery = terms.join(" | ");
      let sql = `
        SELECT content, session_id, ts_rank(tsv, to_tsquery('english', $1)) AS rank
        FROM ${tableName}
        WHERE tsv @@ to_tsquery('english', $1)
      `;
      const params: any[] = [tsQuery];

      if (options?.sessionId) {
        sql += ` AND session_id = $${params.length + 1}`;
        params.push(options.sessionId);
      }

      sql += ` ORDER BY rank DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(sql, params);

      return result.rows.map((r: any) => ({
        content: r.content,
        score: r.rank,
        source: r.session_id,
      }));
    },

    async compact(sessionId: string) {
      const messages = await this.loadMessages(sessionId, 1000);
      if (messages.length <= 20) return;

      const keep = messages.slice(-10);
      await this.clear(sessionId);
      await this.saveMessages(sessionId, [
        { role: "system", content: "[Earlier conversation context was compacted]" },
        ...keep,
      ]);
    },
  };
}
