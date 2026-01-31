import http from 'node:http';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export interface OuraTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class OuraAuth {
  private static readonly TOKEN_DIR = path.join(os.homedir(), '.oura-mcp');
  private static readonly TOKEN_FILE = path.join(OuraAuth.TOKEN_DIR, 'tokens.json');
  private static readonly AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
  private static readonly TOKEN_URL = 'https://api.ouraring.com/oauth/token';
  private static readonly SCOPES = 'email personal daily heartrate workout tag session spo2';
  private static readonly EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly AUTH_TIMEOUT_MS = 120_000; // 120 seconds

  private baseUrl = 'https://api.ouraring.com/v2';
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private tokens: OuraTokens | null = null;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  async ensureAuthenticated(): Promise<void> {
    // Try loading stored tokens
    const stored = await this.loadStoredTokens();
    if (stored) {
      this.tokens = stored;

      if (!this.isTokenExpired()) {
        process.stderr.write('Using cached Oura tokens.\n');
        return;
      }

      // Token expired, try refresh
      process.stderr.write('Oura token expired, attempting refresh...\n');
      try {
        await this.refreshTokens();
        process.stderr.write('Token refreshed successfully.\n');
        return;
      } catch {
        process.stderr.write('Token refresh failed, re-authorization required.\n');
        await this.clearStoredTokens();
      }
    }

    // No valid tokens — run interactive OAuth flow
    process.stderr.write('No valid Oura tokens found. Starting OAuth authorization...\n');
    this.tokens = await this.runAuthorizationFlow();
    await this.saveTokens();
    process.stderr.write('Authorization successful. Tokens saved.\n');
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated. Call ensureAuthenticated() first.');
    }

    if (this.isTokenExpired()) {
      await this.refreshTokens();
    }

    return {
      'Authorization': `Bearer ${this.tokens.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private isTokenExpired(): boolean {
    if (!this.tokens?.expiresAt) return true;
    return Date.now() >= this.tokens.expiresAt - OuraAuth.EXPIRY_BUFFER_MS;
  }

  private async loadStoredTokens(): Promise<OuraTokens | null> {
    try {
      const data = await fs.readFile(OuraAuth.TOKEN_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.accessToken && parsed.refreshToken && parsed.expiresAt) {
        return parsed as OuraTokens;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async saveTokens(): Promise<void> {
    if (!this.tokens) return;

    await fs.mkdir(OuraAuth.TOKEN_DIR, { recursive: true, mode: 0o700 });

    const tmpFile = OuraAuth.TOKEN_FILE + '.tmp';
    await fs.writeFile(tmpFile, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
    await fs.rename(tmpFile, OuraAuth.TOKEN_FILE);
  }

  private async clearStoredTokens(): Promise<void> {
    try {
      await fs.unlink(OuraAuth.TOKEN_FILE);
    } catch {
      // File may not exist
    }
    this.tokens = null;
  }

  private async refreshTokens(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(OuraAuth.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    await this.saveTokens();
  }

  private buildAuthorizeUrl(state: string): string {
    const url = new URL(OuraAuth.AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', OuraAuth.SCOPES);
    url.searchParams.set('state', state);
    return url.toString();
  }

  private async exchangeCodeForTokens(code: string): Promise<OuraTokens> {
    const response = await fetch(OuraAuth.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${body}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  private runAuthorizationFlow(): Promise<OuraTokens> {
    return new Promise((resolve, reject) => {
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUrl = new URL(this.redirectUri);
      const port = parseInt(redirectUrl.port) || 3000;
      const callbackPath = redirectUrl.pathname;

      const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url!, `http://localhost:${port}`);

        if (reqUrl.pathname !== callbackPath) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = reqUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authorization failed</h1><p>You can close this tab.</p></body></html>');
          cleanup();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        const returnedState = reqUrl.searchParams.get('state');
        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Invalid state parameter</h1></body></html>');
          cleanup();
          reject(new Error('OAuth state mismatch — possible CSRF attack'));
          return;
        }

        const code = reqUrl.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>No authorization code received</h1></body></html>');
          cleanup();
          reject(new Error('No authorization code in callback'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authorized!</h1><p>You can close this tab and return to the terminal.</p></body></html>');

        try {
          const tokens = await this.exchangeCodeForTokens(code);
          cleanup();
          resolve(tokens);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Authorization timed out after 120 seconds'));
      }, OuraAuth.AUTH_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timeout);
        server.close();
      }

      server.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Kill the process using it or change OURA_REDIRECT_URI.`));
        } else {
          reject(err);
        }
      });

      server.listen(port, () => {
        const authorizeUrl = this.buildAuthorizeUrl(state);
        process.stderr.write(`\nOpen this URL to authorize with Oura:\n${authorizeUrl}\n\n`);
        this.openBrowser(authorizeUrl);
      });
    });
  }

  private openBrowser(url: string): void {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' :
                platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} "${url}"`, (err) => {
      if (err) {
        process.stderr.write('Could not open browser automatically. Please open the URL above manually.\n');
      }
    });
  }
}
