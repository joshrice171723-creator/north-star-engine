const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createOrganizationPlatform } = require('../electron/organization-platform.cjs');

const port = Number(process.env.LIGHTHOUSE_PORT || 8787);
const root = path.join(__dirname, '..', 'dist');
const dataRoot = process.env.LIGHTHOUSE_DATA_DIR || path.join(process.cwd(), '.lighthouse-data');
const platform = createOrganizationPlatform({ databasePath: path.join(dataRoot, 'organization-platform.sqlite') });
const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }); response.end(JSON.stringify(body)); };
const readBody = (request) => new Promise((resolve, reject) => { let body = ''; request.on('data', (chunk) => { body += chunk; if (body.length > 100000) reject(new Error('Request too large.')); }); request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON.')); } }); request.on('error', reject); });
const route = async (request, response) => {
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' }); return response.end(); }
  if (request.method === 'POST' && request.url?.startsWith('/api/organization/')) {
    try {
      const action = request.url.slice('/api/organization/'.length); const body = await readBody(request); let result;
      if (action === 'bootstrap') { const organization = platform.createOrganization(body); const membership = platform.addStaff({ organizationId: organization.id, email: body.email, displayName: body.displayName, role: 'owner' }); result = platform.createStaffSession({ membershipId: membership.id }); }
      else if (action === 'dev/seed') { if (process.env.LIGHTHOUSE_DEV_MODE !== '1' || !['127.0.0.1', '::1'].includes(request.socket.remoteAddress)) throw new Error('Developer test path is disabled.'); result = platform.createDevelopmentScenario(); }
      else if (action === 'dashboard') result = platform.dashboard(body);
      else if (action === 'locations') result = platform.listLocations(body.sessionToken || body);
      else if (action === 'location/create') result = platform.createLocation(body.sessionToken, body.input || body);
      else if (action === 'staff/add') result = platform.addStaffForSession(body.sessionToken, body.input || body);
      else if (action === 'participants') result = platform.listParticipants(body);
      else if (action === 'invite/create') result = platform.createInvite(body.sessionToken, body.input || body);
      else if (action === 'invite/redeem') result = platform.redeemInvite(body);
      else if (action === 'participant/me') result = platform.participantFromSession(body);
      else if (action === 'extension/issue') result = platform.createExtensionLink(body);
      else if (action === 'extension/claim') result = platform.claimExtensionLink(body);
      else if (action === 'oauth/state/create') result = platform.createOAuthState(body);
      else if (action === 'oauth/state/consume') result = platform.consumeOAuthState(body);
      else if (action === 'event') result = platform.recordParticipantEvent(body.sessionToken, body.eventType, body.metadata);
      else return json(response, 404, { error: 'Organization route not found.' });
      return json(response, 200, result);
    } catch (error) { return json(response, 400, { error: String(error.message || error).slice(0, 300) }); }
  }
  const requested = request.url === '/' ? '/lighthouse.html' : request.url?.split('?')[0]; const filePath = path.resolve(root, `.${requested || '/'}`); const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return json(response, 400, { error: 'Invalid path.' });
  fs.readFile(filePath, (error, content) => { if (error) return json(response, 404, { error: 'Not found.' }); const type = filePath.endsWith('.html') ? 'text/html' : filePath.endsWith('.css') ? 'text/css' : 'text/javascript'; response.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); response.end(content); });
};
const server = http.createServer((request, response) => { route(request, response).catch((error) => json(response, 500, { error: String(error.message || error).slice(0, 300) })); });
server.listen(port, '127.0.0.1', () => console.log(`Lighthouse Jobs listening on http://127.0.0.1:${port}/`));
process.on('SIGINT', () => { platform.close(); server.close(() => process.exit(0)); });
