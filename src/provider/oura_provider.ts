import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OuraAuth } from './oura_connection.js';
import { OuraDB, DailyScore } from './oura_db.js';

export interface OuraConfig {
  auth: OuraAuth;
}

type ReadinessRecord = { day: string; score?: number; contributors?: unknown };
type DailySleepRecord = { day: string; score?: number; contributors?: unknown };
type StressRecord = { day: string; stress_high?: number; recovery_high?: number };
type Spo2Record = { day: string; spo2_percentage?: { average?: number } };
type SleepApiRecord = { id: string; day: string; [key: string]: unknown };

export class OuraProvider {
  private server: McpServer;
  private auth: OuraAuth;
  private db: OuraDB;

  constructor(config: OuraConfig) {
    this.auth = config.auth;
    this.db = new OuraDB();

    this.server = new McpServer({
      name: 'oura-provider',
      version: '1.0.0',
    });

    this.initializeResources();
  }

  private async fetchOuraData(endpoint: string, params?: Record<string, string>): Promise<{ data?: unknown[] }> {
    const headers = await this.auth.getHeaders();
    const url = new URL(`${this.auth.getBaseUrl()}/usercollection/${endpoint}`);

    if (params) {
      process.stderr.write(`Fetching ${endpoint} with dates: ${JSON.stringify(params)}\n`);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${endpoint}: ${response.statusText}`);
    }

    const data = await response.json() as { data?: unknown[] };
    if (data.data && data.data.length > 0) {
      process.stderr.write(
        `Response data for ${endpoint}: ${JSON.stringify(
          (data.data as Array<{ day?: string; timestamp?: string }>).map(d => d.day || d.timestamp)
        )}\n`
      );
    }
    return data;
  }

  private initializeResources(): void {
    const endpoints = [
      { name: 'personal_info', requiresDates: false },
      { name: 'daily_activity', requiresDates: true },
      { name: 'daily_readiness', requiresDates: true },
      { name: 'daily_sleep', requiresDates: true },
      { name: 'sleep', requiresDates: true },
      { name: 'sleep_time', requiresDates: true },
      { name: 'workout', requiresDates: true },
      { name: 'session', requiresDates: true },
      { name: 'daily_spo2', requiresDates: true },
      { name: 'rest_mode_period', requiresDates: true },
      { name: 'ring_configuration', requiresDates: false },
      { name: 'daily_stress', requiresDates: true },
      { name: 'daily_resilience', requiresDates: true },
      { name: 'daily_cardiovascular_age', requiresDates: true },
      { name: 'vO2_max', requiresDates: true },
    ];

    // Register resources
    endpoints.forEach(({ name, requiresDates }) => {
      this.server.resource(name, `oura://${name}`, async uri => {
        let data;
        if (requiresDates) {
          const endDate = new Date().toISOString().split('T')[0];
          const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];
          data = await this.fetchOuraData(name, { start_date: startDate, end_date: endDate });
        } else {
          data = await this.fetchOuraData(name);
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      });
    });

    // Pass-through tools for all date-based endpoints except 'sleep'
    const passThroughEndpoints = endpoints.filter(
      e => e.requiresDates && e.name !== 'sleep'
    );
    for (const { name } of passThroughEndpoints) {
      this.registerDateRangeTool(name);
    }

    // Cached sleep tool
    this.registerCachedSleepTool();

    // Cached daily scores tool (readiness + sleep score + stress + spo2 in parallel)
    this.registerDailyScoresTool();

    // DB stats tool
    this.registerDbStatsTool();
  }

  private registerCachedSleepTool(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server as any).tool(
      'get_sleep',
      'Get sleep data for a date range (cached in local SQLite DB)',
      {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      },
      async (args: { startDate: string; endDate: string }) => {
        const { startDate, endDate } = args;

        const missingDays = this.db.getMissingDays('sleep', startDate, endDate);

        if (missingDays.length > 0) {
          const fetchStart = missingDays[0];
          const fetchEnd = missingDays[missingDays.length - 1];
          process.stderr.write(
            `Fetching missing sleep days from API: ${fetchStart} to ${fetchEnd}\n`
          );

          const apiData = await this.fetchOuraData('sleep', {
            start_date: fetchStart,
            end_date: fetchEnd,
          });

          if (apiData.data && apiData.data.length > 0) {
            this.db.storeSleep(apiData.data as SleepApiRecord[]);
          }

          // Mark all days in the range as fetched (including days with no data)
          this.db.markDaysFetched('sleep', missingDays);
        }

        const cached = this.db.getSleepRange(startDate, endDate);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ data: cached }, null, 2),
            },
          ],
        };
      }
    );
  }

  private registerDailyScoresTool(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server as any).tool(
      'get_daily_scores',
      'Get daily readiness, sleep, stress, and SpO2 scores for a date range (cached)',
      {
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      },
      async (args: { startDate: string; endDate: string }) => {
        const { startDate, endDate } = args;

        const missingDays = this.db.getMissingDays('daily_scores', startDate, endDate);

        if (missingDays.length > 0) {
          const fetchStart = missingDays[0];
          const fetchEnd = missingDays[missingDays.length - 1];
          process.stderr.write(
            `Fetching missing daily_scores from API: ${fetchStart} to ${fetchEnd}\n`
          );

          // Fetch all 4 endpoints in parallel
          const [readinessData, sleepData, stressData, spo2Data] = await Promise.all([
            this.fetchOuraData('daily_readiness', {
              start_date: fetchStart,
              end_date: fetchEnd,
            }),
            this.fetchOuraData('daily_sleep', { start_date: fetchStart, end_date: fetchEnd }),
            this.fetchOuraData('daily_stress', { start_date: fetchStart, end_date: fetchEnd }),
            this.fetchOuraData('daily_spo2', { start_date: fetchStart, end_date: fetchEnd }),
          ]);

          // Build score map — initialise all missing days with null values
          const scoresByDay = new Map<string, DailyScore>();
          for (const day of missingDays) {
            scoresByDay.set(day, {
              day,
              readiness_score: null,
              readiness_contributors: null,
              sleep_score: null,
              sleep_contributors: null,
              stress_high: null,
              recovery_high: null,
              average_spo2: null,
            });
          }

          for (const r of (readinessData.data ?? []) as ReadinessRecord[]) {
            const entry = scoresByDay.get(r.day);
            if (entry) {
              entry.readiness_score = r.score ?? null;
              entry.readiness_contributors = r.contributors ?? null;
            }
          }

          for (const s of (sleepData.data ?? []) as DailySleepRecord[]) {
            const entry = scoresByDay.get(s.day);
            if (entry) {
              entry.sleep_score = s.score ?? null;
              entry.sleep_contributors = s.contributors ?? null;
            }
          }

          for (const st of (stressData.data ?? []) as StressRecord[]) {
            const entry = scoresByDay.get(st.day);
            if (entry) {
              entry.stress_high = st.stress_high ?? null;
              entry.recovery_high = st.recovery_high ?? null;
            }
          }

          for (const sp of (spo2Data.data ?? []) as Spo2Record[]) {
            const entry = scoresByDay.get(sp.day);
            if (entry) {
              entry.average_spo2 = sp.spo2_percentage?.average ?? null;
            }
          }

          const scoresToStore = Array.from(scoresByDay.values());
          this.db.storeDailyScores(scoresToStore);
          this.db.markDaysFetched('daily_scores', missingDays);
        }

        const cached = this.db.getDailyScoresRange(startDate, endDate);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ data: cached }, null, 2),
            },
          ],
        };
      }
    );
  }

  private registerDbStatsTool(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server as any).tool(
      'oura_db_stats',
      'Get statistics about the local Oura SQLite cache',
      {},
      async () => {
        const stats = this.db.getStats();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }
    );
  }

  private registerDateRangeTool(endpointName: string): void {
    const inputSchema = {
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server as any).tool(
      `get_${endpointName}`,
      `Get ${endpointName} data for a date range`,
      inputSchema,
      async (args: { startDate: string; endDate: string }) => {
        const data = await this.fetchOuraData(endpointName, {
          start_date: args.startDate,
          end_date: args.endDate,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }
    );
  }

  getServer(): McpServer {
    return this.server;
  }
}
