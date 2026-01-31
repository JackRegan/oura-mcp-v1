import { config as dotenvConfig } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OuraProvider } from './provider/oura_provider.js';
import { OuraAuth } from './provider/oura_connection.js';

dotenvConfig({ path: 'credentials.env' });

const config = {
  auth: {
    clientId: process.env.OURA_CLIENT_ID || '',
    clientSecret: process.env.OURA_CLIENT_SECRET || '',
    redirectUri: process.env.OURA_REDIRECT_URI || 'http://localhost:3000/callback',
  },
};

function validateConfig() {
  if (!config.auth.clientId || !config.auth.clientSecret) {
    throw new Error(
      'OURA_CLIENT_ID and OURA_CLIENT_SECRET must be provided. ' +
      'Get them from https://cloud.ouraring.com/oauth/applications'
    );
  }
}

async function main() {
  validateConfig();

  const auth = new OuraAuth(
    config.auth.clientId,
    config.auth.clientSecret,
    config.auth.redirectUri
  );
  await auth.ensureAuthenticated();

  const provider = new OuraProvider({ auth });
  const transport = new StdioServerTransport();
  await provider.getServer().connect(transport);
}

main().catch(error => {
  process.stderr.write(`Server error: ${error.message}\n`);
  process.exit(1);
});
