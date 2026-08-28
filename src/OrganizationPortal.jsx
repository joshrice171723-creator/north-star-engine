import React, { useEffect, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Clipboard,
  HelpCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import "./organization.css";

const routes = {
  organizationBootstrap: "bootstrap",
  organizationDashboard: "dashboard",
  organizationListParticipants: "participants",
  organizationCreateInvite: "invite/create",
  organizationRedeemInvite: "invite/redeem",
  organizationParticipantMe: "participant/me",
  organizationIssueExtensionLink: "extension/issue",
  organizationDevelopmentSeed: "dev/seed",
  organizationCreateLocation: "location/create",
  organizationListLocations: "locations",
  organizationAddStaffForSession: "staff/add",
};
const apiOrigin =
  import.meta.env.DEV &&
  ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
    ? "http://127.0.0.1:8787"
    : "";
const request = async (name, payload) => {
  if (window.desktopShell?.[name])
    return window.desktopShell[name](
      ...(Array.isArray(payload) ? payload : [payload]),
    );
  const body = Array.isArray(payload)
    ? { sessionToken: payload[0], input: payload[1] }
    : (payload ?? {});
  const response = await fetch(
    `${apiOrigin}/api/organization/${routes[name] || name}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const raw = await response.text();
  let result = {};
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `Organization API returned an unreadable response (${response.status}). Start the Lighthouse API server and try again.`,
    );
  }
  if (!response.ok)
    throw new Error(
      result.error || `Organization request failed (${response.status}).`,
    );
  return result;
};

function Brand({ partner = false }) {
  return (
    <div className="lighthouse-brand">
      <div className="lighthouse-mark" aria-hidden="true">
        ✦
      </div>
      <div>
        <b>{partner ? "North Star" : "Lighthouse Jobs"}</b>
        <span>{partner ? "Partner workspace" : "Participant workspace"}</span>
      </div>
    </div>
  );
}
function PrivacyNote() {
  return (
    <aside className="privacy-note">
      <ShieldCheck size={20} />
      <div>
        <b>Privacy is built in</b>
        <p>
          We collect only what is needed to provide access. Participant career
          records stay private.
        </p>
      </div>
    </aside>
  );
}

function readBootstrapForm(formElement, fallback) {
  const fields = Array.from(formElement.querySelectorAll("input"));
  return {
    name: fields[0]?.value?.trim() || fallback.name,
    displayName: fields[1]?.value?.trim() || fallback.displayName,
    email: fields[2]?.value?.trim() || fallback.email,
  };
}

export function StaffPortal() {
  const [session, setSession] = useState(
    () => sessionStorage.getItem("north-star-staff-session") || "",
  );
  const [form, setForm] = useState({ name: "", email: "", displayName: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [invite, setInvite] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationName, setLocationName] = useState("");
  const [staffForm, setStaffForm] = useState({
    email: "",
    displayName: "",
    role: "employee",
    locationId: "",
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (session) return undefined;
    const timer = setTimeout(() => {
      const fields = Array.from(
        document.querySelectorAll(".partner-page .lighthouse-form input"),
      );
      if (fields.length >= 3 && fields.some((field) => field.value))
        setForm({
          name: fields[0].value,
          displayName: fields[1].value,
          email: fields[2].value,
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [session]);
  const refresh = async () => {
    try {
      setDashboard(await request("organizationDashboard", session));
      setParticipants(await request("organizationListParticipants", session));
      setLocations(await request("organizationListLocations", session));
    } catch (error) {
      setMessage(error.message);
    }
  };
  useEffect(() => {
    if (session) refresh();
  }, [session]);
  const bootstrap = async (event) => {
    event.preventDefault();
    const fields = event.currentTarget.elements;
    const submitted = {
      name: String(fields.organizationName?.value || form.name).trim(),
      displayName: String(fields.displayName?.value || form.displayName).trim(),
      email: String(fields.email?.value || form.email).trim(),
    };
    if (!submitted.name || !submitted.displayName || !submitted.email) {
      setMessage("Please complete organization name, your name, and work email.");
      return;
    }
    try {
      const result = await request("organizationBootstrap", submitted);
      sessionStorage.setItem("north-star-staff-session", result.token);
      setSession(result.token);
      setMessage("Workspace created.");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const createInvite = async (event) => {
    event.preventDefault();
    try {
      setInvite(
        await request("organizationCreateInvite", [
          session,
          { email: inviteEmail },
        ]),
      );
      setInviteEmail("");
      setMessage("Invite ready to share.");
      await refresh();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const createLocation = async (event) => {
    event.preventDefault();
    try {
      await request("organizationCreateLocation", [
        session,
        { name: locationName },
      ]);
      setLocationName("");
      setMessage("Location added.");
      await refresh();
    } catch (error) {
      setMessage(error.message);
    }
  };
  const addStaff = async (event) => {
    event.preventDefault();
    try {
      await request("organizationAddStaffForSession", [session, staffForm]);
      setStaffForm({
        email: "",
        displayName: "",
        role: "employee",
        locationId: staffForm.locationId,
      });
      setMessage("Staff account created.");
    } catch (error) {
      setMessage(error.message);
    }
  };
  if (!session)
    return (
      <section className="lighthouse-page partner-page">
        <div className="lighthouse-topbar">
          <Brand partner />
          <a href="#help">
            <HelpCircle size={16} /> Help
          </a>
        </div>
        <main className="lighthouse-content setup-content">
          <span className="lighthouse-kicker">PARTNER ADMIN</span>
          <h1>Set up your partner workspace.</h1>
          <p className="lighthouse-lede">
            Create a private workspace for your team to invite participants and
            support their employment goals.
          </p>
          <form className="lighthouse-form" onSubmit={bootstrap}>
            <label>
              Organization name
              <input
                name="organizationName"
                autoComplete="organization"
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="Harbor Works"
              />
            </label>
            <label>
              Your name
              <input
                name="displayName"
                autoComplete="name"
                required
                value={form.displayName}
                onChange={(event) =>
                  setForm({ ...form, displayName: event.target.value })
                }
                placeholder="Your name"
              />
            </label>
            <label>
              Work email
              <input
                name="email"
                autoComplete="email"
                required
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                placeholder="you@organization.org"
              />
            </label>
            <button className="lighthouse-primary" type="submit">
              Create workspace <ArrowRight size={16} />
            </button>
          </form>
          <PrivacyNote />
        </main>
      </section>
    );
  const count = dashboard?.counts?.participants ?? 0;
  return (
    <section className="lighthouse-page partner-page">
      <div className="lighthouse-topbar">
        <Brand partner />
        <div className="topbar-right">
          <span className="privacy-chip">
            <ShieldCheck size={15} /> Privacy first
          </span>
          <button className="text-button" onClick={refresh}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>
      <main className="lighthouse-content">
        <div className="page-heading">
          <div>
            <span className="lighthouse-kicker">PARTNER WORKSPACE</span>
            <h1>{dashboard?.organization?.name || "Your partner workspace"}</h1>
            <p className="lighthouse-lede">
              A clear view of your program and the people you support.
            </p>
          </div>
          <span className="role-pill">Partner administrator</span>
        </div>
        <section className="invite-hero">
          <div>
            <span className="lighthouse-kicker">NEXT STEP</span>
            <h2>Invite a participant</h2>
            <p>
              Send a secure, single-use invitation. You only need their email
              address.
            </p>
          </div>
          <form className="invite-form" onSubmit={createInvite}>
            <label className="sr-only" htmlFor="participant-email">
              Participant email
            </label>
            <input
              id="participant-email"
              required
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="participant@example.org"
            />
            <button className="lighthouse-primary" type="submit">
              Create invite <ArrowRight size={16} />
            </button>
          </form>
        </section>
        {invite && (
          <div className="invite-result" role="status">
            <div>
              <Check size={18} />
              <div>
                <b>Invite created</b>
                <span>
                  Copy this code now. It is shown only once and expires in 72
                  hours.
                </span>
              </div>
            </div>
            <code>{invite.inviteToken}</code>
            <button
              className="outline-button"
              onClick={() => navigator.clipboard?.writeText(invite.inviteToken)}
            >
              <Clipboard size={15} /> Copy code
            </button>
          </div>
        )}
        <section className="snapshot-section">
          <div className="section-title">
            <div>
              <span className="lighthouse-kicker">PROGRAM SNAPSHOT</span>
              <h2>People in your program</h2>
            </div>
            <span className="muted-label">Aggregate information only</span>
          </div>
          <div className="snapshot-grid">
            <div>
              <Users size={20} />
              <b>{count}</b>
              <span>Participants</span>
            </div>
            <div>
              <Building2 size={20} />
              <b>{dashboard?.locations?.length || locations.length}</b>
              <span>Locations</span>
            </div>
            <div>
              <ShieldCheck size={20} />
              <b>Private</b>
              <span>Career records</span>
            </div>
          </div>
        </section>
        <section className="directory-section">
          <div className="section-title">
            <div>
              <span className="lighthouse-kicker">PARTICIPANT DIRECTORY</span>
              <h2>People in scope</h2>
            </div>
            <span className="muted-label">{count} total</span>
          </div>
          {participants.length ? (
            <div className="directory-list">
              {participants.map((participant) => (
                <div className="directory-row" key={participant.id}>
                  <div className="avatar">
                    {String(participant.displayName || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                  <div>
                    <b>{participant.displayName}</b>
                    <span>{participant.email}</span>
                  </div>
                  <em>Active</em>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Users size={24} />
              <b>No participants yet</b>
              <span>Create an invite above to get started.</span>
            </div>
          )}
        </section>
        <div className="admin-tools">
          <details>
            <summary>
              <Plus size={15} /> Manage locations and staff
            </summary>
            <div className="admin-tools-grid">
              <form className="compact-form" onSubmit={createLocation}>
                <h3>Locations</h3>
                <label>
                  New location
                  <input
                    required
                    value={locationName}
                    onChange={(event) => setLocationName(event.target.value)}
                    placeholder="Downtown site"
                  />
                </label>
                <button className="outline-button" type="submit">
                  Add location
                </button>
                <small>
                  {locations.map((location) => location.name).join(" · ") ||
                    "No locations added yet."}
                </small>
              </form>
              <form className="compact-form" onSubmit={addStaff}>
                <h3>Staff accounts</h3>
                <label>
                  Name
                  <input
                    required
                    value={staffForm.displayName}
                    onChange={(event) =>
                      setStaffForm({
                        ...staffForm,
                        displayName: event.target.value,
                      })
                    }
                    placeholder="Program employee"
                  />
                </label>
                <label>
                  Work email
                  <input
                    required
                    type="email"
                    value={staffForm.email}
                    onChange={(event) =>
                      setStaffForm({ ...staffForm, email: event.target.value })
                    }
                    placeholder="employee@example.org"
                  />
                </label>
                <label>
                  Role
                  <select
                    value={staffForm.role}
                    onChange={(event) =>
                      setStaffForm({ ...staffForm, role: event.target.value })
                    }
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Location manager</option>
                  </select>
                </label>
                <label>
                  Location
                  <select
                    required
                    value={staffForm.locationId}
                    onChange={(event) =>
                      setStaffForm({
                        ...staffForm,
                        locationId: event.target.value,
                      })
                    }
                  >
                    <option value="">Select location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="outline-button" type="submit">
                  Create staff account
                </button>
              </form>
            </div>
          </details>
        </div>
        {message && (
          <p className="lighthouse-message" role="status">
            {message}
          </p>
        )}
      </main>
    </section>
  );
}

function ParticipantPortal() {
  const [session, setSession] = useState(
    () => sessionStorage.getItem("lighthouse-participant-session") || "",
  );
  const [inviteToken, setInviteToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profile, setProfile] = useState(null);
  const [link, setLink] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (session)
      request("organizationParticipantMe", session)
        .then(setProfile)
        .catch(() => {
          sessionStorage.removeItem("lighthouse-participant-session");
          setSession("");
        });
  }, [session]);
  const redeem = async (event) => {
    event.preventDefault();
    try {
      const result = await request("organizationRedeemInvite", {
        inviteToken,
        displayName,
      });
      sessionStorage.setItem("lighthouse-participant-session", result.token);
      setSession(result.token);
      setProfile({
        participant: result.participant,
        organization: result.organization,
      });
      setMessage("You are connected.");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const issueLink = async () => {
    try {
      setLink(await request("organizationIssueExtensionLink", session));
      setMessage("Your one-time extension code is ready.");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const developerPath =
    import.meta.env.DEV &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const seedDeveloperScenario = async () => {
    try {
      const result = await request("organizationDevelopmentSeed", {});
      sessionStorage.setItem(
        "lighthouse-participant-session",
        result.participantSession.token,
      );
      sessionStorage.setItem(
        "north-star-dev-staff-session",
        result.staffSession.token,
      );
      setSession(result.participantSession.token);
      setProfile({
        participant: result.participantSession.participant,
        organization: result.participantSession.organization,
      });
      setLink(result.extension);
      setMessage(`Developer scenario ready for ${result.organization.name}.`);
    } catch (error) {
      setMessage(error.message);
    }
  };
  if (!session || !profile)
    return (
      <section className="lighthouse-page participant-page">
        <div className="lighthouse-topbar">
          <Brand />
          <a href="#help">
            <HelpCircle size={16} /> Help
          </a>
        </div>
        <main className="lighthouse-content participant-content">
          <div className="participant-intro">
            <span className="lighthouse-kicker">WELCOME</span>
            <h1>Your next opportunity starts here.</h1>
            <p className="lighthouse-lede">
              Join your employment workspace to find work that fits your goals.
              Your information stays yours.
            </p>
          </div>
          <div className="participant-grid">
            <div className="join-panel">
              <div className="step-line">
                <span className="step-number">1</span>
                <b>Join with your invite</b>
                <span className="step-rule" />
                <span className="step-muted">2 You’re in</span>
              </div>
              <p>Enter the invite code your organization gave you.</p>
              <form className="lighthouse-form" onSubmit={redeem}>
                <label>
                  Invite code
                  <input
                    required
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    placeholder="Paste your invite code"
                    autoComplete="one-time-code"
                  />
                </label>
                <label>
                  Your name
                  <input
                    required
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </label>
                <button className="lighthouse-primary" type="submit">
                  Join workspace <ArrowRight size={16} />
                </button>
              </form>
            </div>
            <PrivacyNote />
          </div>
          {developerPath && (
            <div className="developer-tools">
              <b>Developer test path</b>
              <span>Only visible in local development.</span>
              <button
                className="outline-button"
                type="button"
                onClick={seedDeveloperScenario}
              >
                Seed local test scenario
              </button>
            </div>
          )}
          {message && (
            <p className="lighthouse-message" role="status">
              {message}
            </p>
          )}
          <footer className="lighthouse-footer">
            <span>Need help getting started?</span>
            <a href="#help">
              Contact support <ArrowRight size={14} />
            </a>
          </footer>
        </main>
      </section>
    );
  return (
    <section className="lighthouse-page participant-page">
      <div className="lighthouse-topbar">
        <Brand />
        <a href="#help">
          <HelpCircle size={16} /> Help
        </a>
      </div>
      <main className="lighthouse-content participant-content">
        <div className="participant-intro">
          <span className="lighthouse-kicker">YOUR WORKSPACE</span>
          <h1>Welcome, {profile.participant.displayName}.</h1>
          <p className="lighthouse-lede">
            You’re connected to {profile.organization.name}. Let’s take the next
            step toward work that fits.
          </p>
        </div>
        <div className="participant-grid">
          <section className="join-panel connected-panel">
            <div className="connected-icon">
              <Check size={20} />
            </div>
            <span className="lighthouse-kicker">YOU’RE CONNECTED</span>
            <h2>Connect ApplyPilot</h2>
            <p>
              Use a one-time code to connect the browser helper when you are
              ready to apply. Staff cannot see your applications, documents, or
              email.
            </p>
            <button className="lighthouse-primary" onClick={issueLink}>
              Generate extension code <ArrowRight size={16} />
            </button>
            {link && (
              <div className="code-result">
                <code>{link.code}</code>
                <span>Expires {new Date(link.expiresAt).toLocaleString()}</span>
              </div>
            )}
          </section>
          <PrivacyNote />
        </div>
        {message && (
          <p className="lighthouse-message" role="status">
            {message}
          </p>
        )}
        <footer className="lighthouse-footer">
          <span>Your career workspace is private by default.</span>
          <a href="#help">
            Get help <ArrowRight size={14} />
          </a>
        </footer>
      </main>
    </section>
  );
}

export default function OrganizationPortal({ participant = false }) {
  return participant ? <ParticipantPortal /> : <StaffPortal />;
}
