# Oura MCP Server

A Model Context Protocol (MCP) server for accessing Oura Ring data.

## Setup

### Prerequisites
- Node.js (v18+)
- Oura account

### Installation
1. Clone the repository
2. Run:
```
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
```
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

## Available Resources
- `personal_info` - User profile
- `daily_activity` - Activity summaries
- `daily_readiness` - Readiness scores
- `daily_sleep` - Sleep summaries
- `sleep` - Detailed sleep data
- `sleep_time` - Sleep timing
- `workout` - Workout data
- `session` - Session data
- `daily_spo2` - SpO2 measurements
- `rest_mode_period` - Rest periods
- `ring_configuration` - Ring config
- `daily_stress` - Stress metrics
- `daily_resilience` - Resilience metrics
- `daily_cardiovascular_age` - CV age
- `vO2_max` - VO2 max data

## Available Tools
For date-based resources, use tools like `get_daily_sleep` with `startDate` and `endDate` parameters (YYYY-MM-DD).
