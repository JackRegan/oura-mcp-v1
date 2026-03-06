import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface DailyScore {
  day: string;
  readiness_score: number | null;
  readiness_contributors: unknown;
  sleep_score: number | null;
  sleep_contributors: unknown;
  stress_high: number | null;
  recovery_high: number | null;
  average_spo2: number | null;
}

export class OuraDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ||
      process.env.OURA_DB_PATH ||
      path.join(os.homedir(), 'Documents', 'health_data', 'oura_sleep.db');

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
    process.stderr.write(`OuraDB opened: ${resolvedPath}\n`);
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sleep (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sleep_day_idx ON sleep(day);

      CREATE TABLE IF NOT EXISTS daily_scores (
        day TEXT PRIMARY KEY,
        readiness_score INTEGER,
        readiness_contributors TEXT,
        sleep_score INTEGER,
        sleep_contributors TEXT,
        stress_high INTEGER,
        recovery_high INTEGER,
        average_spo2 REAL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fetched_dates (
        table_name TEXT NOT NULL,
        day TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (table_name, day)
      );
    `);
  }

  private getDaysInRange(startDate: string, endDate: string): string[] {
    const days: string[] = [];
    const current = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');

    while (current <= end) {
      days.push(current.toISOString().split('T')[0]);
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return days;
  }

  getMissingDays(tableName: 'sleep' | 'daily_scores', startDate: string, endDate: string): string[] {
    const allDays = this.getDaysInRange(startDate, endDate);
    const stmt = this.db.prepare(
      'SELECT day FROM fetched_dates WHERE table_name = ? AND day >= ? AND day <= ?'
    );
    const rows = stmt.all(tableName, startDate, endDate) as { day: string }[];
    const fetchedDays = new Set(rows.map(r => r.day));
    return allDays.filter(d => !fetchedDays.has(d));
  }

  markDaysFetched(tableName: 'sleep' | 'daily_scores', days: string[]): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO fetched_dates (table_name, day, fetched_at) VALUES (?, ?, ?)'
    );
    const insertMany = this.db.transaction((ds: string[]) => {
      const now = new Date().toISOString();
      for (const day of ds) {
        stmt.run(tableName, day, now);
      }
    });
    insertMany(days);
  }

  getSleepRange(startDate: string, endDate: string): unknown[] {
    const stmt = this.db.prepare(
      'SELECT data FROM sleep WHERE day >= ? AND day <= ? ORDER BY day'
    );
    const rows = stmt.all(startDate, endDate) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as unknown);
  }

  storeSleep(records: Array<{ id: string; day: string; [key: string]: unknown }>): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sleep (id, day, data) VALUES (?, ?, ?)'
    );
    const insertMany = this.db.transaction(
      (recs: Array<{ id: string; day: string; [key: string]: unknown }>) => {
        for (const rec of recs) {
          stmt.run(rec.id, rec.day, JSON.stringify(rec));
        }
      }
    );
    insertMany(records);
  }

  getDailyScoresRange(startDate: string, endDate: string): unknown[] {
    const stmt = this.db.prepare(
      'SELECT * FROM daily_scores WHERE day >= ? AND day <= ? ORDER BY day'
    );
    return stmt.all(startDate, endDate);
  }

  storeDailyScores(scores: DailyScore[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO daily_scores
        (day, readiness_score, readiness_contributors, sleep_score, sleep_contributors,
         stress_high, recovery_high, average_spo2, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = this.db.transaction((recs: DailyScore[]) => {
      const now = new Date().toISOString();
      for (const rec of recs) {
        stmt.run(
          rec.day,
          rec.readiness_score,
          rec.readiness_contributors != null ? JSON.stringify(rec.readiness_contributors) : null,
          rec.sleep_score,
          rec.sleep_contributors != null ? JSON.stringify(rec.sleep_contributors) : null,
          rec.stress_high,
          rec.recovery_high,
          rec.average_spo2,
          now
        );
      }
    });
    insertMany(scores);
  }

  getStats(): object {
    const sleepCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM sleep').get() as { count: number }
    ).count;
    const sleepRange = this.db.prepare('SELECT MIN(day) as min, MAX(day) as max FROM sleep').get() as {
      min: string | null;
      max: string | null;
    };

    const scoresCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM daily_scores').get() as { count: number }
    ).count;
    const scoresRange = this.db
      .prepare('SELECT MIN(day) as min, MAX(day) as max FROM daily_scores')
      .get() as { min: string | null; max: string | null };

    const fetchedCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM fetched_dates').get() as { count: number }
    ).count;

    return {
      sleep: {
        records: sleepCount,
        range: sleepRange.min ? `${sleepRange.min} to ${sleepRange.max}` : 'empty',
      },
      daily_scores: {
        records: scoresCount,
        range: scoresRange.min ? `${scoresRange.min} to ${scoresRange.max}` : 'empty',
      },
      fetch_log: {
        entries: fetchedCount,
      },
    };
  }

  close(): void {
    this.db.close();
  }
}
