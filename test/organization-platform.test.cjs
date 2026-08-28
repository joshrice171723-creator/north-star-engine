const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOrganizationPlatform } = require('../electron/organization-platform.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'north-star-org-'));
  const platform = createOrganizationPlatform({ databasePath: path.join(directory, 'organization-platform.sqlite') });
  return { directory, platform };
}

test('organization onboarding, tenant-scoped dashboard, and one-use extension link work end to end', () => {
  const { directory, platform } = fixture();
  try {
    const first = platform.createOrganization({ name: 'Harbor Works' });
    const second = platform.createOrganization({ name: 'North County Jobs' });
    const staff = platform.addStaff({ organizationId: first.id, email: 'staff@harbor.example', displayName: 'Harbor Staff', role: 'admin' });
    const staffSession = platform.createStaffSession({ membershipId: staff.id });
    const invite = platform.createInvite(staffSession.token, { email: 'participant@example.com' });
    const participantSession = platform.redeemInvite({ inviteToken: invite.inviteToken, email: 'participant@example.com', displayName: 'Participant One' });
    assert.equal(participantSession.organization.id, first.id);
    assert.throws(() => platform.redeemInvite({ inviteToken: invite.inviteToken, email: 'participant@example.com' }), /invalid, expired, or already used/);
    const dashboard = platform.dashboard(staffSession.token);
    assert.equal(dashboard.organization.id, first.id);
    assert.equal(dashboard.counts.participants, 1);
    assert.deepEqual(platform.listParticipants(staffSession.token).map((entry) => entry.email), ['participant@example.com']);
    const code = platform.createExtensionLink(participantSession.token);
    const extension = platform.claimExtensionLink({ code: code.code });
    assert.equal(extension.organizationId, first.id);
    assert.throws(() => platform.claimExtensionLink({ code: code.code }), /invalid, expired, or already used/);
    assert.notEqual(first.id, second.id);
    assert.throws(() => platform.dashboard('not-a-session'), /invalid or expired/);
  } finally { platform.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('OAuth state is bound to provider, nonce, redirect, expiry, and single use', () => {
  const { directory, platform } = fixture();
  try {
    const state = platform.createOAuthState({ provider: 'google', redirectUri: 'https://lighthouse.jobs/oauth/callback' });
    assert.deepEqual(platform.consumeOAuthState({ provider: 'google', state: state.state, nonce: state.nonce, redirectUri: state.redirectUri }), { ok: true, provider: 'google', redirectUri: state.redirectUri });
    assert.throws(() => platform.consumeOAuthState({ provider: 'google', state: state.state, nonce: state.nonce, redirectUri: state.redirectUri }), /validation failed/);
  } finally { platform.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('developer scenario creates real tenant-scoped sessions and a one-use extension code', () => {
  const { directory, platform } = fixture();
  try {
    const scenario = platform.createDevelopmentScenario();
    assert.equal(scenario.developmentOnly, true);
    assert.equal(platform.dashboard(scenario.staffSession.token).counts.participants, 1);
    assert.equal(platform.participantFromSession(scenario.participantSession.token).organization.id, scenario.organization.id);
    assert.equal(platform.claimExtensionLink({ code: scenario.extension.code }).organizationId, scenario.organization.id);
    assert.throws(() => platform.claimExtensionLink({ code: scenario.extension.code }), /invalid, expired, or already used/);
  } finally { platform.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('organization, location manager, and employee scopes are enforced', () => {
  const { directory, platform } = fixture();
  try {
    const organization = platform.createOrganization({ name: 'Three Site Works' });
    const owner = platform.addStaff({ organizationId: organization.id, email: 'owner@example.com', displayName: 'Owner', role: 'owner' });
    const ownerSession = platform.createStaffSession({ membershipId: owner.id });
    const satellite = platform.createLocation(ownerSession.token, { name: 'Satellite One' });
    const manager = platform.addStaff({ organizationId: organization.id, locationId: satellite.id, email: 'manager@example.com', displayName: 'Manager', role: 'manager' });
    const managerSession = platform.createStaffSession({ membershipId: manager.id });
    const employee = platform.addStaffForSession(managerSession.token, { locationId: satellite.id, email: 'employee@example.com', displayName: 'Employee', role: 'employee' });
    const employeeSession = platform.createStaffSession({ membershipId: employee.id });
    const invite = platform.createInvite(employeeSession.token, { email: 'satellite-participant@example.com' });
    platform.redeemInvite({ inviteToken: invite.inviteToken, email: invite.email, displayName: 'Satellite Participant' });
    assert.equal(platform.dashboard(ownerSession.token).counts.participants, 1);
    assert.equal(platform.dashboard(managerSession.token).counts.participants, 1);
    assert.equal(platform.dashboard(employeeSession.token).counts.participants, 1);
    assert.equal(platform.dashboard(ownerSession.token).locations.length, 2);
    assert.deepEqual(platform.listParticipants(employeeSession.token).map((entry) => entry.email), ['satellite-participant@example.com']);
    assert.throws(() => platform.createLocation(managerSession.token, { name: 'Unauthorized Site' }), /Only organization management/);
    assert.throws(() => platform.createInvite(managerSession.token, { email: 'other@example.com', locationId: organization.id }), /location/);
  } finally { platform.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
