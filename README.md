# Oura MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for accessing Oura Ring health data. Provides tools and resources for querying sleep, activity, readiness, and other health metrics from the Oura API.

> **Originally created by [elizabethtrykin](https://github.com/elizabethtrykin).** This fork adds OAuth2 authorization code flow (replacing Personal Access Token auth), refactored provider architecture, and improved logging.

## What's Changed

- **OAuth2 Authorization Code Flow** - Interactive browser-based authentication with automatic token refresh, replacing the deprecated PAT approach
- **Token Persistence** - Tokens cached to `~/.oura-mcp/tokens.json` with secure file permissions; automatic refresh before expiry
- **CSRF Protection** - Cryptographic state parameter validation during the OAuth callback
- **Refactored Provider** - Simplified capabilities structure and improved tool registration and logging

## Setup

### Prerequisites
- Node.js (v18+)
- Oura account

### Installation
1. Clone the repository
2. Run:
```bash
npm install
npm run build
```

## Configuration

### Obtaining OAuth2 Credentials
1. Log in to [Oura Cloud Console](https://cloud.ouraring.com/)
2. Go to [OAuth Applications](https://cloud.ouraring.com/oauth/applications)
3. Create a new application
4. Set the redirect URI to `http://localhost:3000/callback`
5. Copy the Client ID and Client Secret

### Environment Variables
Create a `.env` file:
```
OURA_CLIENT_ID=your_client_id
OURA_CLIENT_SECRET=your_client_secret
OURA_REDIRECT_URI=http://localhost:3000/callback
```

### First Run Authorization
On first run, the server will:
1. Open your browser to the Oura authorization page
2. After you approve, redirect back to the local callback server
3. Save tokens to `~/.oura-mcp/tokens.json`

Subsequent runs will use the cached tokens and refresh them automatically.

## Usage

### Testing
```bash
node test.js <tool_name> <date>
```
Example: `node test.js get_daily_sleep 2025-01-30`

### Claude Desktop Integration
Add to Claude Desktop's config (Settings > Developer > Edit Config):
```json
{
    "mcpServers": {
        "oura": {
            "command": "node",
            "args": ["/absolute/path/to/oura-mcp/build/index.js"],
            "env": {
                "OURA_CLIENT_ID": "your_client_id",
                "OURA_CLIENT_SECRET": "your_client_secret",
                "OURA_REDIRECT_URI": "http://localhost:3000/callback"
            }
        }
    }
}
```
Restart Claude Desktop after saving. See [MCP docs](https://modelcontextprotocol.io/quickstart/user) for details.

## Available Tools

All date-based tools accept `startDate` and `endDate` parameters in `YYYY-MM-DD` format.

| Tool | Description |
|------|-------------|
| `get_daily_activity` | Activity summaries |
| `get_daily_readiness` | Readiness scores |
| `get_daily_sleep` | Sleep summaries |
| `get_sleep` | Detailed sleep data |
| `get_sleep_time` | Sleep timing recommendations |
| `get_workout` | Workout data |
| `get_session` | Session data |
| `get_daily_spo2` | SpO2 measurements |
| `get_rest_mode_period` | Rest mode periods |
| `get_daily_stress` | Stress metrics |
| `get_daily_resilience` | Resilience metrics |
| `get_daily_cardiovascular_age` | Cardiovascular age |
| `get_vO2_max` | VO2 max data |

## Available Resources

| Resource | Description |
|----------|-------------|
| `personal_info` | User profile |
| `ring_configuration` | Ring configuration |

## Credits

- Original implementation by [elizabethtrykin](https://github.com/elizabethtrykin)
- OAuth2 flow and refactoring by [JackRegan](https://github.com/JackRegan)

## License

ISC
