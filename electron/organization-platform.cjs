const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const BetterSqlite3 = require('better-sqlite3');

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const bounded = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const email = (value) => bounded(value, 320).toLowerCase();
const expiry = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

const schema = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_locations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organization_id, name), FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL,
  display_name TEXT NOT NULL, role TEXT NOT NULL, location_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organization_id, email), FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE IF NOT EXISTS participant_profiles (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL,
  display_name TEXT NOT NULL, location_id TEXT, sponsor_membership_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', consent_version TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(organization_id, email), FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE IF NOT EXISTS organization_invites (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL,
  role TEXT NOT NULL, location_id TEXT, sponsor_membership_id TEXT,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
  redeemed_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE IF NOT EXISTS platform_sessions (
  id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  organization_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL, revoked_at TEXT, FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE TABLE IF NOT EXISTS extension_link_codes (
  id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, claimed_at TEXT,
  created_at TEXT NOT NULL, FOREIGN KEY(participant_id) REFERENCES participant_profiles(id)
);
CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_events (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, actor_type TEXT NOT NULL,
  actor_id TEXT, event_type TEXT NOT NULL, subject_type TEXT, subject_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
CREATE INDEX IF NOT EXISTS organization_events_rollup_idx ON organization_events(organization_id, event_type, created_at);
`;

function createOrganizationPlatform({ databasePath, clock = now } = {}) {
  if (!databasePath) throw new Error('Organization platform database path is required.');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new BetterSqlite3(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  const addColumn = (table, column, definition) => { const columns = db.prepare(`PRAGMA table_info(${table})`).all(); if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); };
  addColumn('organization_memberships', 'location_id', 'TEXT');
  addColumn('participant_profiles', 'location_id', 'TEXT');
  addColumn('participant_profiles', 'sponsor_membership_id', 'TEXT');
  addColumn('organization_invites', 'location_id', 'TEXT');
  addColumn('organization_invites', 'sponsor_membership_id', 'TEXT');
  const stamp = () => clock();
  const issueSession = (subjectType, subjectId, organizationId, hours = 24) => {
    const raw = token();
    db.prepare('INSERT INTO platform_sessions (id, subject_type, subject_id, organization_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id('session'), subjectType, subjectId, organizationId, hash(raw), expiry(hours), stamp());
    return raw;
  };
  const session = (raw, requiredType) => {
    const row = db.prepare("SELECT * FROM platform_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > datetime('now')").get(hash(raw || ''));
    if (!row || (requiredType && row.subject_type !== requiredType)) throw new Error('Platform session is invalid or expired.');
    return row;
  };
  const org = (organizationId) => db.prepare('SELECT id, name, slug, status, created_at AS createdAt, updated_at AS updatedAt FROM organizations WHERE id = ? AND status = \'active\'').get(organizationId);
  const recordEvent = ({ organizationId, actorType, actorId = null, eventType, subjectType = null, subjectId = null, metadata = {} }) => {
    db.prepare('INSERT INTO organization_events (id, organization_id, actor_type, actor_id, event_type, subject_type, subject_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id('event'), organizationId, actorType, actorId, eventType, subjectType, subjectId, JSON.stringify(metadata), stamp());
  };
  return {
    close: () => db.close(),
    createOrganization(input = {}) {
      const name = bounded(input.name); if (!name) throw new Error('Organization name is required.');
      const slug = bounded(input.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), 80);
      if (!slug) throw new Error('Organization slug is required.');
      const organization = { id: id('org'), name, slug, created_at: stamp(), updated_at: stamp() };
      db.prepare('INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(...Object.values(organization));
      db.prepare('INSERT INTO organization_locations (id, organization_id, name, is_primary, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(id('location'), organization.id, 'Primary location', stamp(), stamp());
      recordEvent({ organizationId: organization.id, actorType: 'system', eventType: 'organization_created' });
      return org(organization.id);
    },
    createDevelopmentScenario() {
      const suffix = crypto.randomBytes(4).toString('hex');
      const organization = this.createOrganization({ name: `Lighthouse Dev ${suffix}`, slug: `lighthouse-dev-${suffix}` });
      const membership = this.addStaff({ organizationId: organization.id, email: `staff-${suffix}@dev.local`, displayName: 'Developer Staff', role: 'owner' });
      const staffSession = this.createStaffSession({ membershipId: membership.id });
      const invite = this.createInvite(staffSession.token, { email: `participant-${suffix}@dev.local` });
      const participantSession = this.redeemInvite({ inviteToken: invite.inviteToken, email: invite.email, displayName: 'Developer Participant' });
      const extension = this.createExtensionLink(participantSession.token);
      return { organization, staffSession, participantSession, extension, developmentOnly: true };
    },
    addStaff(input = {}) {
      const organizationId = bounded(input.organizationId, 160); const target = org(organizationId);
      if (!target) throw new Error('Organization not found.');
      const staffEmail = email(input.email); const displayName = bounded(input.displayName || staffEmail);
      if (!staffEmail || !staffEmail.includes('@') || !displayName) throw new Error('Valid staff email and name are required.');
      const role = ['owner', 'admin', 'manager', 'employee', 'staff'].includes(input.role) ? input.role : 'staff';
      const locationId = bounded(input.locationId, 160) || null;
      if (locationId && !db.prepare('SELECT id FROM organization_locations WHERE id = ? AND organization_id = ? AND status = \'active\'').get(locationId, organizationId)) throw new Error('Staff location not found.');
      const membership = { id: id('membership'), organization_id: organizationId, email: staffEmail, display_name: displayName, role, location_id: locationId, created_at: stamp(), updated_at: stamp() };
      db.prepare('INSERT INTO organization_memberships (id, organization_id, email, display_name, role, location_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, email) DO UPDATE SET display_name=excluded.display_name, role=excluded.role, location_id=excluded.location_id, status=\'active\', updated_at=excluded.updated_at').run(...Object.values(membership));
      return db.prepare('SELECT id, organization_id AS organizationId, email, display_name AS displayName, role, status FROM organization_memberships WHERE organization_id = ? AND email = ?').get(organizationId, staffEmail);
    },
    createLocation(rawSession, input = {}) {
      const actor = session(rawSession, 'staff');
      if (!['owner', 'admin'].includes(db.prepare('SELECT role FROM organization_memberships WHERE id = ?').get(actor.subject_id)?.role)) throw new Error('Only organization management can create locations.');
      const name = bounded(input.name, 160); if (!name) throw new Error('Location name is required.');
      const location = { id: id('location'), organization_id: actor.organization_id, name, created_at: stamp(), updated_at: stamp() };
      db.prepare('INSERT INTO organization_locations (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(...Object.values(location));
      recordEvent({ organizationId: actor.organization_id, actorType: 'staff', actorId: actor.subject_id, eventType: 'location_created', subjectType: 'location', subjectId: location.id });
      return db.prepare('SELECT id, organization_id AS organizationId, name, is_primary AS isPrimary, status FROM organization_locations WHERE id = ?').get(location.id);
    },
    listLocations(rawSession) { const actor = session(rawSession, 'staff'); return db.prepare('SELECT id, organization_id AS organizationId, name, is_primary AS isPrimary, status FROM organization_locations WHERE organization_id = ? AND status = \'active\' ORDER BY is_primary DESC, name').all(actor.organization_id); },
    addStaffForSession(rawSession, input = {}) {
      const actor = session(rawSession, 'staff'); const actorMembership = db.prepare('SELECT * FROM organization_memberships WHERE id = ? AND status = \'active\'').get(actor.subject_id);
      if (!actorMembership || !['owner', 'admin', 'manager'].includes(actorMembership.role)) throw new Error('This account cannot manage staff.');
      const locationId = bounded(input.locationId, 160); if (actorMembership.location_id && actorMembership.location_id !== locationId) throw new Error('You can only manage staff at your location.');
      const role = ['manager', 'employee'].includes(input.role) ? input.role : 'employee';
      return this.addStaff({ ...input, organizationId: actor.organization_id, locationId, role });
    },
    createStaffSession(input = {}) {
      const membership = db.prepare('SELECT * FROM organization_memberships WHERE id = ? AND status = \'active\'').get(bounded(input.membershipId, 160));
      if (!membership) throw new Error('Staff membership not found.');
      return { token: issueSession('staff', membership.id, membership.organization_id), organization: org(membership.organization_id), membership: { id: membership.id, email: membership.email, displayName: membership.display_name, role: membership.role } };
    },
    createInvite(rawSession, input = {}) {
      const actor = session(rawSession, 'staff'); const membership = db.prepare('SELECT * FROM organization_memberships WHERE id = ? AND status = \'active\'').get(actor.subject_id); const organization = org(actor.organization_id);
      if (!organization) throw new Error('Organization not found.');
      const inviteEmail = email(input.email); if (!inviteEmail.includes('@')) throw new Error('A valid participant email is required.');
      const locationId = bounded(input.locationId, 160) || membership.location_id || db.prepare('SELECT id FROM organization_locations WHERE organization_id = ? AND is_primary = 1').get(actor.organization_id)?.id;
      if (!locationId || !db.prepare('SELECT id FROM organization_locations WHERE id = ? AND organization_id = ? AND status = \'active\'').get(locationId, actor.organization_id)) throw new Error('Participant location not found.');
      if (membership.location_id && membership.location_id !== locationId) throw new Error('You can only invite participants at your location.');
      const raw = token(18); const record = { id: id('invite'), organization_id: actor.organization_id, email: inviteEmail, role: 'participant', location_id: locationId, sponsor_membership_id: actor.subject_id, token_hash: hash(raw), expires_at: input.expiresAt || expiry(72), created_at: stamp() };
      db.prepare('INSERT INTO organization_invites (id, organization_id, email, role, location_id, sponsor_membership_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...Object.values(record));
      recordEvent({ organizationId: actor.organization_id, actorType: 'staff', actorId: actor.subject_id, eventType: 'participant_invited', subjectType: 'invite', subjectId: record.id, metadata: { locationId } });
      return { id: record.id, organizationId: record.organization_id, email: record.email, expiresAt: record.expires_at, inviteToken: raw };
    },
    redeemInvite(input = {}) {
      const invite = db.prepare("SELECT * FROM organization_invites WHERE token_hash = ? AND redeemed_at IS NULL AND expires_at > datetime('now')").get(hash(input.inviteToken || ''));
      if (!invite) throw new Error('Invite is invalid, expired, or already used.');
      const participantEmail = email(input.email || invite.email); if (participantEmail !== invite.email) throw new Error('Invite email does not match.');
      const participantId = id('participant'); const displayName = bounded(input.displayName || participantEmail);
      const tx = db.transaction(() => { db.prepare('INSERT INTO participant_profiles (id, organization_id, email, display_name, location_id, sponsor_membership_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, email) DO UPDATE SET display_name=excluded.display_name, location_id=excluded.location_id, sponsor_membership_id=excluded.sponsor_membership_id, status=\'active\', updated_at=excluded.updated_at').run(participantId, invite.organization_id, participantEmail, displayName, invite.location_id, invite.sponsor_membership_id, stamp(), stamp()); db.prepare('UPDATE organization_invites SET redeemed_at = ? WHERE id = ?').run(stamp(), invite.id); recordEvent({ organizationId: invite.organization_id, actorType: 'participant', actorId: participantId, eventType: 'participant_onboarded', subjectType: 'participant', subjectId: participantId, metadata: { locationId: invite.location_id } }); }); tx();
      const participant = db.prepare('SELECT id, organization_id AS organizationId, email, display_name AS displayName, status FROM participant_profiles WHERE organization_id = ? AND email = ?').get(invite.organization_id, participantEmail);
      return { token: issueSession('participant', participant.id, participant.organizationId, 12), participant, organization: org(invite.organization_id) };
    },
    participantFromSession(rawSession) { const actor = session(rawSession, 'participant'); const participant = db.prepare('SELECT id, organization_id AS organizationId, email, display_name AS displayName, status FROM participant_profiles WHERE id = ? AND organization_id = ?').get(actor.subject_id, actor.organization_id); if (!participant) throw new Error('Participant not found.'); return { participant, organization: org(actor.organization_id) }; },
    createExtensionLink(rawSession) { const actor = session(rawSession, 'participant'); const raw = token(12); const record = { id: id('link'), participant_id: actor.subject_id, organization_id: actor.organization_id, code_hash: hash(raw), expires_at: expiry(1), created_at: stamp() }; db.prepare('INSERT INTO extension_link_codes (id, participant_id, organization_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(...Object.values(record)); recordEvent({ organizationId: actor.organization_id, actorType: 'participant', actorId: actor.subject_id, eventType: 'extension_link_issued', subjectType: 'extension_link', subjectId: record.id }); return { code: raw, expiresAt: record.expires_at }; },
    claimExtensionLink(input = {}) { const link = db.prepare("SELECT * FROM extension_link_codes WHERE code_hash = ? AND claimed_at IS NULL AND expires_at > datetime('now')").get(hash(input.code || '')); if (!link) throw new Error('Link code is invalid, expired, or already used.'); db.prepare('UPDATE extension_link_codes SET claimed_at = ? WHERE id = ?').run(stamp(), link.id); const extensionToken = issueSession('extension', link.participant_id, link.organization_id, 24 * 30); recordEvent({ organizationId: link.organization_id, actorType: 'extension', actorId: link.participant_id, eventType: 'extension_linked', subjectType: 'extension_link', subjectId: link.id }); return { token: extensionToken, participantId: link.participant_id, organizationId: link.organization_id }; },
    createOAuthState(input = {}) { const provider = ['google', 'microsoft'].includes(input.provider) ? input.provider : ''; const redirectUri = bounded(input.redirectUri, 1000); if (!provider || !redirectUri) throw new Error('Supported OAuth provider and redirect URI are required.'); const rawState = token(24); const nonce = token(18); const record = { id: id('oauth'), provider, state_hash: hash(rawState), nonce_hash: hash(nonce), redirect_uri: redirectUri, expires_at: expiry(10), created_at: stamp() }; db.prepare('INSERT INTO oauth_states (id, provider, state_hash, nonce_hash, redirect_uri, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...Object.values(record)); return { state: rawState, nonce, provider, redirectUri, expiresAt: record.expires_at }; },
    consumeOAuthState(input = {}) { const state = db.prepare("SELECT * FROM oauth_states WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > datetime('now')").get(hash(input.state || '')); if (!state || state.provider !== input.provider || hash(input.nonce || '') !== state.nonce_hash || bounded(input.redirectUri, 1000) !== state.redirect_uri) throw new Error('OAuth state validation failed.'); db.prepare('UPDATE oauth_states SET consumed_at = ? WHERE id = ?').run(stamp(), state.id); return { ok: true, provider: state.provider, redirectUri: state.redirect_uri }; },
    dashboard(rawSession) { const actor = session(rawSession, 'staff'); const membership = db.prepare('SELECT * FROM organization_memberships WHERE id = ?').get(actor.subject_id); const filter = membership.location_id ? ' AND location_id = ?' : ''; const params = membership.location_id ? [actor.organization_id, membership.location_id] : [actor.organization_id]; const participantFilter = membership.role === 'employee' ? `${filter} AND sponsor_membership_id = ?` : filter; const participantParams = membership.role === 'employee' ? [...params, membership.id] : params; const counts = db.prepare(`SELECT COUNT(*) AS participants FROM participant_profiles WHERE organization_id = ? AND status = 'active'${participantFilter}`).get(...participantParams); let events; if (membership.role === 'employee') events = db.prepare("SELECT event_type AS eventType, COUNT(*) AS count FROM organization_events WHERE organization_id = ? AND (actor_id = ? OR subject_id IN (SELECT id FROM participant_profiles WHERE organization_id = ? AND sponsor_membership_id = ?)) GROUP BY event_type ORDER BY count DESC").all(actor.organization_id, membership.id, actor.organization_id, membership.id); else if (membership.location_id) events = db.prepare("SELECT event_type AS eventType, COUNT(*) AS count FROM organization_events WHERE organization_id = ? AND json_extract(metadata_json, '$.locationId') = ? GROUP BY event_type ORDER BY count DESC").all(actor.organization_id, membership.location_id); else events = db.prepare('SELECT event_type AS eventType, COUNT(*) AS count FROM organization_events WHERE organization_id = ? GROUP BY event_type ORDER BY count DESC').all(actor.organization_id); const locations = membership.location_id ? [] : db.prepare("SELECT l.id, l.name, COUNT(p.id) AS participants FROM organization_locations l LEFT JOIN participant_profiles p ON p.location_id = l.id AND p.status = 'active' WHERE l.organization_id = ? AND l.status = 'active' GROUP BY l.id ORDER BY l.is_primary DESC, l.name").all(actor.organization_id); return { organization: org(actor.organization_id), scope: membership.location_id ? { type: membership.role === 'employee' ? 'sponsored_participants' : 'location', locationId: membership.location_id } : { type: 'organization' }, counts: { participants: counts.participants }, locations, events }; },
    listParticipants(rawSession) { const actor = session(rawSession, 'staff'); const membership = db.prepare('SELECT * FROM organization_memberships WHERE id = ?').get(actor.subject_id); const conditions = ['organization_id = ?']; const params = [actor.organization_id]; if (membership.location_id) { conditions.push('location_id = ?'); params.push(membership.location_id); } if (membership.role === 'employee') { conditions.push('sponsor_membership_id = ?'); params.push(membership.id); } return db.prepare(`SELECT id, email, display_name AS displayName, location_id AS locationId, status, created_at AS createdAt FROM participant_profiles WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`).all(...params); },
    recordParticipantEvent(rawSession, eventType, metadata = {}) { const actor = session(rawSession); recordEvent({ organizationId: actor.organization_id, actorType: actor.subject_type, actorId: actor.subject_id, eventType: bounded(eventType, 100), metadata }); return { ok: true }; },
  };
}

module.exports = { createOrganizationPlatform, hash };
