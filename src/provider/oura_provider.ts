import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OuraAuth } from './oura_connection.js';

export interface OuraConfig {
  auth: OuraAuth;
}

export class OuraProvider {
  private server: McpServer;
  private auth: OuraAuth;

  constructor(config: OuraConfig) {
    this.auth = config.auth;

    this.server = new McpServer({
      name: "oura-provider",
      version: "1.0.0"
    });

    this.initializeResources();
  }

  private async fetchOuraData(endpoint: string, params?: Record<string, string>): Promise<any> {
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

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      process.stderr.write(`Response data for ${endpoint}: ${JSON.stringify(data.data.map((d: { day?: string; timestamp?: string }) => d.day || d.timestamp))}\n`);
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
      { name: 'vO2_max', requiresDates: true }
    ];

    // Register resources
    endpoints.forEach(({ name, requiresDates }) => {
      this.server.resource(
        name,
        `oura://${name}`,
        async (uri) => {
          let data;
          if (requiresDates) {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            data = await this.fetchOuraData(name, { start_date: startDate, end_date: endDate });
          } else {
            data = await this.fetchOuraData(name);
          }

          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(data, null, 2)
            }]
          };
        }
      );
    });

    // Register tools
    const dateBasedEndpoints = endpoints.filter(e => e.requiresDates);

    for (const { name } of dateBasedEndpoints) {
      this.registerDateRangeTool(name);
    }
  }

  private registerDateRangeTool(endpointName: string): void {
    const inputSchema = {
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)')
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server as any).tool(
      `get_${endpointName}`,
      `Get ${endpointName} data for a date range`,
      inputSchema,
      async (args: { startDate: string; endDate: string }) => {
        const data = await this.fetchOuraData(endpointName, {
          start_date: args.startDate,
          end_date: args.endDate
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(data, null, 2)
          }]
        };
      }
    );
  }

  getServer(): McpServer {
    return this.server;
  }
}
