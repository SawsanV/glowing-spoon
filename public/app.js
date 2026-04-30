// =====================================================
// Total Battle tracker — frontend logic
// =====================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/config.js";

if (SUPABASE_URL.startsWith("PASTE_") || SUPABASE_ANON_KEY.startsWith("PASTE_")) {
  document.body.innerHTML = `
    <div style="padding:40px;text-align:center;font-family:Georgia,serif;color:#e8dcc4;">
      <h2 style="color:#c9a14a;">Setup needed</h2>
      <p>Edit <code>public/config.js</code> and paste your Supabase URL and anon key.</p>
    </div>`;
  throw new Error("Supabase config missing.");
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ------------------------------------------------------
// State
// ------------------------------------------------------
const state = {
  user: null,           // auth user
  profile: null,        // profiles row
  activeTab: "captains",
  filterUserId: null,   // null = "me", or another user's id
  profiles: [],         // all profiles, for compare + filter dropdown
  data: {
    captains: [],       // all captain_snapshots for current view
    hero: [],
    artifacts: []
  },
  signupMode: false
};

// ------------------------------------------------------
// DOM helpers
// ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function fmtNum(n) {
  if (n == null || n === "") return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return "—";
  return num.toLocaleString();
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ------------------------------------------------------
// Auth flow
// ------------------------------------------------------
function setAuthMode(mode) {
  state.signupMode = mode === "signup";
  $("#auth-title").textContent = state.signupMode ? "Create account" : "Sign in";
  $("#auth-sub").textContent = state.signupMode
    ? "Forge your name in the ledger."
    : "Welcome back, captain.";
  $("#auth-submit").textContent = state.signupMode ? "Create account" : "Sign in";
  $("#auth-toggle-text").textContent = state.signupMode ? "Already have an account?" : "No account?";
  $("#auth-toggle-link").textContent = state.signupMode ? "Sign in" : "Sign up";
  $$(".signup-only").forEach(el => state.signupMode ? show(el) : hide(el));
  hideAuthMsg();
}

function showAuthMsg(text, kind = "error") {
  const el = $("#auth-msg");
  el.textContent = text;
  el.className = `msg ${kind}`;
}
function hideAuthMsg() { hide($("#auth-msg")); }

async function handleAuthSubmit() {
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  if (!email || !password) {
    showAuthMsg("Email and password required.");
    return;
  }
  const btn = $("#auth-submit");
  btn.disabled = true;

  try {
    if (state.signupMode) {
      const username = $("#auth-username").value.trim();
      const code = $("#auth-code").value.trim();
      if (!username || username.length < 2) {
        showAuthMsg("Username must be at least 2 characters.");
        return;
      }
      if (!code) {
        showAuthMsg("Group code required.");
        return;
      }

      // Verify group code first
      const { data: codeOk, error: codeErr } = await sb.rpc("verify_signup_code", { code_attempt: code });
      if (codeErr) { showAuthMsg("Could not verify code: " + codeErr.message); return; }
      if (!codeOk) { showAuthMsg("Invalid group code."); return; }

      // Sign up with metadata so the trigger can pick up the username
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { username } }
      });
      if (error) { showAuthMsg(error.message); return; }
      showAuthMsg("Check your email to confirm your account.", "info");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { showAuthMsg(error.message); return; }
      // Session change handler will load the app
    }
  } finally {
    btn.disabled = false;
  }
}

async function handleSignOut() {
  await sb.auth.signOut();
  state.user = null;
  state.profile = null;
  showAuthScreen();
}

// ------------------------------------------------------
// Boot / session handling
// ------------------------------------------------------
async function boot() {
  // Wire up auth screen
  $("#auth-submit").addEventListener("click", handleAuthSubmit);
  $("#auth-toggle-link").addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode(state.signupMode ? "signin" : "signup");
  });
  $("#signout-btn").addEventListener("click", handleSignOut);
  $("#admin-btn").addEventListener("click", openAdminModal);

  // Tabs
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Add buttons
  $("#add-captain-btn").addEventListener("click", () => openCaptainModal());
  $("#update-hero-btn").addEventListener("click", () => openHeroModal());
  $("#add-artifact-btn").addEventListener("click", () => openArtifactModal());

  // Filter
  $("#user-filter").addEventListener("change", (e) => {
    state.filterUserId = e.target.value === "me" ? null : e.target.value;
    refreshActiveTab();
  });

  setAuthMode("signin");

  const { data } = await sb.auth.getSession();
  if (data.session) {
    await loadProfileAndApp();
  } else {
    showAuthScreen();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      await loadProfileAndApp();
    } else if (event === "SIGNED_OUT") {
      showAuthScreen();
    }
  });
}

function showAuthScreen() {
  show($("#auth-screen"));
  hide($("#main-screen"));
  hide($("#user-bar"));
}

async function loadProfileAndApp() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { showAuthScreen(); return; }
  state.user = user;

  // Wait for profile row (created by trigger)
  let profile = null;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (data) { profile = data; break; }
    await new Promise(r => setTimeout(r, 400));
  }
  if (!profile) {
    showAuthMsg("Profile not found. Try signing out and back in.", "error");
    return;
  }
  state.profile = profile;

  // Show app
  hide($("#auth-screen"));
  show($("#main-screen"));
  show($("#user-bar"));
  $("#user-display").textContent = profile.username;
  if (profile.is_admin) show($("#admin-btn")); else hide($("#admin-btn"));

  await loadAllProfiles();
  await refreshActiveTab();
}

async function loadAllProfiles() {
  const { data, error } = await sb.from("profiles").select("id, username, is_admin").order("username");
  if (error) { console.error(error); return; }
  state.profiles = data || [];
  // Populate filter
  const sel = $("#user-filter");
  sel.innerHTML = `<option value="me">My roster</option>` +
    state.profiles
      .filter(p => p.id !== state.user.id)
      .map(p => `<option value="${p.id}">${escapeHtml(p.username)}</option>`)
      .join("");
}

// ------------------------------------------------------
// Tab switching
// ------------------------------------------------------
function switchTab(tab) {
  state.activeTab = tab;
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $$(".tab-panel").forEach(p => hide(p));
  show($(`#tab-${tab}`));
  refreshActiveTab();
}

async function refreshActiveTab() {
  if (!state.user) return;
  switch (state.activeTab) {
    case "captains": return renderCaptains();
    case "hero": return renderHero();
    case "artifacts": return renderArtifacts();
    case "compare": return renderCompare();
  }
}

function viewedUserId() {
  return state.filterUserId || state.user.id;
}

// ------------------------------------------------------
// Snapshot fetching helpers
// ------------------------------------------------------
async function fetchAllSnapshots(table, userId) {
  const { data, error } = await sb
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

// Group snapshots by item name, returning latest + history per item
function groupByName(snapshots, nameField) {
  const map = new Map();
  for (const s of snapshots) {
    const key = s[nameField];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  // Each item's array is already sorted desc by recorded_at because of the ORDER BY
  return map;
}

// ------------------------------------------------------
// CAPTAINS
// ------------------------------------------------------
async function renderCaptains() {
  const userId = viewedUserId();
  const snapshots = await fetchAllSnapshots("captain_snapshots", userId);
  const grouped = groupByName(snapshots, "captain_name");
  const list = $("#captains-list");
  const isMine = userId === state.user.id;

  // Hide add button when viewing someone else's roster
  $("#add-captain-btn").style.display = isMine ? "" : "none";

  if (grouped.size === 0) {
    list.innerHTML = `<div class="empty-state">No captains recorded yet.${isMine ? ' Click "Add captain" to start.' : ""}</div>`;
    return;
  }

  list.innerHTML = "";
  for (const [name, snaps] of grouped) {
    const latest = snaps[0];
    const prev = snaps[1];
    list.appendChild(renderItemCard({
      name,
      latest,
      prev,
      isMine,
      kind: "captain",
      stats: [
        { label: "Level", value: latest.level },
        { label: "Power", value: fmtNum(latest.power) }
      ],
      notes: latest.gear_notes,
      history: snaps
    }));
  }
}

// ------------------------------------------------------
// HERO
// ------------------------------------------------------
async function renderHero() {
  const userId = viewedUserId();
  const snapshots = await fetchAllSnapshots("hero_snapshots", userId);
  const isMine = userId === state.user.id;
  $("#update-hero-btn").style.display = isMine ? "" : "none";

  const display = $("#hero-display");
  if (snapshots.length === 0) {
    display.innerHTML = `<div class="empty-state">No hero recorded yet.${isMine ? " Click \"+ New snapshot\" to start." : ""}</div>`;
    return;
  }

  const latest = snapshots[0];
  const prev = snapshots[1];

  display.innerHTML = "";
  display.appendChild(renderItemCard({
    name: latest.hero_name,
    latest,
    prev,
    isMine,
    kind: "hero",
    stats: [
      { label: "Level", value: latest.level },
      { label: "Stars", value: latest.stars },
      { label: "Power", value: fmtNum(latest.power) }
    ],
    notes: latest.gear_notes,
    history: snapshots
  }));
}

// ------------------------------------------------------
// ARTIFACTS
// ------------------------------------------------------
async function renderArtifacts() {
  const userId = viewedUserId();
  const snapshots = await fetchAllSnapshots("artifact_snapshots", userId);
  const grouped = groupByName(snapshots, "artifact_name");
  const list = $("#artifacts-list");
  const isMine = userId === state.user.id;
  $("#add-artifact-btn").style.display = isMine ? "" : "none";

  if (grouped.size === 0) {
    list.innerHTML = `<div class="empty-state">No artifacts recorded yet.${isMine ? ' Click "Add artifact" to start.' : ""}</div>`;
    return;
  }

  list.innerHTML = "";
  for (const [name, snaps] of grouped) {
    const latest = snaps[0];
    const prev = snaps[1];
    list.appendChild(renderItemCard({
      name,
      latest,
      prev,
      isMine,
      kind: "artifact",
      stats: [
        { label: "Level", value: latest.level },
        { label: "Stars", value: latest.stars }
      ],
      notes: latest.notes,
      history: snaps
    }));
  }
}

// ------------------------------------------------------
// Item card renderer (shared across captains/hero/artifacts)
// ------------------------------------------------------
function renderItemCard({ name, latest, prev, isMine, kind, stats, notes, history }) {
  const card = document.createElement("div");
  card.className = "card";

  const statsHtml = stats.map(s => {
    let deltaHtml = "";
    if (prev && s.label !== "" && typeof latest === "object") {
      // Try to compute delta for numeric stats
      const fieldMap = {
        "Level": "level", "Stars": "stars", "Power": "power"
      };
      const field = fieldMap[s.label];
      if (field && latest[field] != null && prev[field] != null) {
        const d = Number(latest[field]) - Number(prev[field]);
        if (d > 0) deltaHtml = ` <span class="delta-up">▲ ${fmtNum(d)}</span>`;
        else if (d < 0) deltaHtml = ` <span class="delta-down">▼ ${fmtNum(Math.abs(d))}</span>`;
      }
    }
    return `<div class="stat-row"><span class="lbl">${s.label}</span><span>${escapeHtml(String(s.value ?? "—"))}${deltaHtml}</span></div>`;
  }).join("");

  const ownerName = isMine ? "" : (state.profiles.find(p => p.id === latest.user_id)?.username || "");

  card.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-name">${escapeHtml(name)}</div>
        ${ownerName ? `<div class="card-owner">${escapeHtml(ownerName)}</div>` : ""}
      </div>
    </div>
    ${statsHtml}
    ${notes ? `<div class="stat-row" style="margin-top:6px;"><span class="lbl">Notes</span></div><div style="font-size:13px;color:var(--text-dim);font-style:italic;">${escapeHtml(notes)}</div>` : ""}
    <div class="stat-row" style="margin-top:8px;"><span class="lbl">Updated</span><span>${fmtDate(latest.recorded_at)}</span></div>
    ${renderSparkline(history)}
    <div class="card-actions">
      <button class="ghost-btn small" data-action="history">History (${history.length})</button>
      ${isMine ? `<button class="primary-btn small" data-action="update">Update</button>` : ""}
      ${isMine ? `<button class="danger-btn small" data-action="delete-snap">Delete latest</button>` : ""}
    </div>
  `;

  card.querySelector('[data-action="history"]').addEventListener("click", () => openHistoryModal(name, history, kind));
  if (isMine) {
    card.querySelector('[data-action="update"]').addEventListener("click", () => {
      if (kind === "captain") openCaptainModal({ prefill: latest });
      else if (kind === "hero") openHeroModal({ prefill: latest });
      else if (kind === "artifact") openArtifactModal({ prefill: latest });
    });
    card.querySelector('[data-action="delete-snap"]').addEventListener("click", async () => {
      if (!confirm(`Delete latest snapshot of ${name}? (history is kept)`)) return;
      const tableMap = { captain: "captain_snapshots", hero: "hero_snapshots", artifact: "artifact_snapshots" };
      const { error } = await sb.from(tableMap[kind]).delete().eq("id", latest.id);
      if (error) alert(error.message);
      else refreshActiveTab();
    });
  }

  return card;
}

// Tiny inline SVG sparkline for power over time
function renderSparkline(history) {
  if (!history || history.length < 2) return "";
  const powers = history.map(s => Number(s.power || s.level || 0)).filter(n => !Number.isNaN(n));
  if (powers.length < 2) return "";
  const ordered = [...powers].reverse(); // oldest -> newest
  const min = Math.min(...ordered);
  const max = Math.max(...ordered);
  const range = max - min || 1;
  const w = 260, h = 36;
  const stepX = w / (ordered.length - 1);
  const points = ordered.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline fill="none" stroke="var(--gold)" stroke-width="1.5" points="${points}"/>
  </svg>`;
}

// ------------------------------------------------------
// MODALS — captain / hero / artifact / history / admin
// ------------------------------------------------------
function openModal(html) {
  $("#modal").innerHTML = html;
  show($("#modal-backdrop"));
}
function closeModal() { hide($("#modal-backdrop")); }
$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

function openCaptainModal({ prefill = null } = {}) {
  openModal(`
    <h3>${prefill ? "Update" : "Add"} captain</h3>
    <div class="field"><label>Captain name</label>
      <input id="m-name" value="${escapeHtml(prefill?.captain_name || "")}" ${prefill ? "readonly" : ""}/></div>
    <div class="field"><label>Level</label><input id="m-level" type="number" value="${prefill?.level ?? ""}"/></div>
    <div class="field"><label>Power</label><input id="m-power" type="number" value="${prefill?.power ?? ""}"/></div>
    <div class="field"><label>Gear notes (optional)</label><textarea id="m-notes" rows="2">${escapeHtml(prefill?.gear_notes || "")}</textarea></div>
    <div class="modal-actions">
      <button class="ghost-btn" id="m-cancel">Cancel</button>
      <button class="primary-btn" id="m-save">Save snapshot</button>
    </div>
  `);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-save").addEventListener("click", async () => {
    const name = $("#m-name").value.trim();
    if (!name) return alert("Captain name required.");
    const row = {
      user_id: state.user.id,
      captain_name: name,
      level: $("#m-level").value ? Number($("#m-level").value) : null,
      power: $("#m-power").value ? Number($("#m-power").value) : null,
      gear_notes: $("#m-notes").value.trim() || null
    };
    const { error } = await sb.from("captain_snapshots").insert(row);
    if (error) return alert(error.message);
    closeModal();
    refreshActiveTab();
  });
}

function openHeroModal({ prefill = null } = {}) {
  openModal(`
    <h3>${prefill ? "Update" : "Add"} hero snapshot</h3>
    <div class="field"><label>Hero name</label>
      <input id="m-name" value="${escapeHtml(prefill?.hero_name || "")}"/></div>
    <div class="field"><label>Level</label><input id="m-level" type="number" value="${prefill?.level ?? ""}"/></div>
    <div class="field"><label>Stars</label><input id="m-stars" type="number" value="${prefill?.stars ?? ""}"/></div>
    <div class="field"><label>Power</label><input id="m-power" type="number" value="${prefill?.power ?? ""}"/></div>
    <div class="field"><label>Gear notes (optional)</label><textarea id="m-notes" rows="2">${escapeHtml(prefill?.gear_notes || "")}</textarea></div>
    <div class="modal-actions">
      <button class="ghost-btn" id="m-cancel">Cancel</button>
      <button class="primary-btn" id="m-save">Save snapshot</button>
    </div>
  `);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-save").addEventListener("click", async () => {
    const name = $("#m-name").value.trim();
    if (!name) return alert("Hero name required.");
    const row = {
      user_id: state.user.id,
      hero_name: name,
      level: $("#m-level").value ? Number($("#m-level").value) : null,
      stars: $("#m-stars").value ? Number($("#m-stars").value) : null,
      power: $("#m-power").value ? Number($("#m-power").value) : null,
      gear_notes: $("#m-notes").value.trim() || null
    };
    const { error } = await sb.from("hero_snapshots").insert(row);
    if (error) return alert(error.message);
    closeModal();
    refreshActiveTab();
  });
}

function openArtifactModal({ prefill = null } = {}) {
  openModal(`
    <h3>${prefill ? "Update" : "Add"} artifact</h3>
    <div class="field"><label>Artifact name</label>
      <input id="m-name" value="${escapeHtml(prefill?.artifact_name || "")}" ${prefill ? "readonly" : ""}/></div>
    <div class="field"><label>Level</label><input id="m-level" type="number" value="${prefill?.level ?? ""}"/></div>
    <div class="field"><label>Stars</label><input id="m-stars" type="number" value="${prefill?.stars ?? ""}"/></div>
    <div class="field"><label>Notes (optional)</label><textarea id="m-notes" rows="2">${escapeHtml(prefill?.notes || "")}</textarea></div>
    <div class="modal-actions">
      <button class="ghost-btn" id="m-cancel">Cancel</button>
      <button class="primary-btn" id="m-save">Save snapshot</button>
    </div>
  `);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-save").addEventListener("click", async () => {
    const name = $("#m-name").value.trim();
    if (!name) return alert("Artifact name required.");
    const row = {
      user_id: state.user.id,
      artifact_name: name,
      level: $("#m-level").value ? Number($("#m-level").value) : null,
      stars: $("#m-stars").value ? Number($("#m-stars").value) : null,
      notes: $("#m-notes").value.trim() || null
    };
    const { error } = await sb.from("artifact_snapshots").insert(row);
    if (error) return alert(error.message);
    closeModal();
    refreshActiveTab();
  });
}

function openHistoryModal(name, history, kind) {
  const rows = history.map((h, i) => {
    const next = history[i + 1];
    let delta = "";
    if (next && h.power != null && next.power != null) {
      const d = Number(h.power) - Number(next.power);
      if (d > 0) delta = `<span class="delta-up">+${fmtNum(d)}</span>`;
      else if (d < 0) delta = `<span class="delta-down">${fmtNum(d)}</span>`;
    }
    const fields = [];
    if (h.level != null) fields.push(`L${h.level}`);
    if (h.stars != null) fields.push(`★${h.stars}`);
    if (h.power != null) fields.push(`P ${fmtNum(h.power)}`);
    return `<div class="history-row"><span>${fmtDate(h.recorded_at)}</span><span>${fields.join(" · ")} ${delta}</span></div>`;
  }).join("");

  openModal(`
    <h3>${escapeHtml(name)} — history</h3>
    <div class="history-list">${rows}</div>
    <div class="modal-actions">
      <button class="primary-btn" id="m-close">Close</button>
    </div>
  `);
  $("#m-close").addEventListener("click", closeModal);
}

// ------------------------------------------------------
// Compare tab — side-by-side group view
// ------------------------------------------------------
async function renderCompare() {
  const container = $("#compare-content");
  container.innerHTML = `<div class="muted">Loading group data…</div>`;

  // Fetch latest snapshot per (user, hero_name) etc.
  const [captainsRes, heroRes, artifactsRes] = await Promise.all([
    sb.from("captain_snapshots").select("*").order("recorded_at", { ascending: false }),
    sb.from("hero_snapshots").select("*").order("recorded_at", { ascending: false }),
    sb.from("artifact_snapshots").select("*").order("recorded_at", { ascending: false })
  ]);

  if (captainsRes.error || heroRes.error || artifactsRes.error) {
    container.innerHTML = `<div class="empty-state">Could not load group data.</div>`;
    return;
  }

  // Latest hero per user
  const latestHero = new Map();
  for (const s of heroRes.data || []) {
    if (!latestHero.has(s.user_id)) latestHero.set(s.user_id, s);
  }

  // Captain count + total power per user (sum of latest per captain)
  const userCaptains = new Map();
  for (const s of captainsRes.data || []) {
    if (!userCaptains.has(s.user_id)) userCaptains.set(s.user_id, new Map());
    const m = userCaptains.get(s.user_id);
    if (!m.has(s.captain_name)) m.set(s.captain_name, s);
  }

  const userArtifactsCount = new Map();
  for (const s of artifactsRes.data || []) {
    if (!userArtifactsCount.has(s.user_id)) userArtifactsCount.set(s.user_id, new Set());
    userArtifactsCount.get(s.user_id).add(s.artifact_name);
  }

  const rows = state.profiles.map(p => {
    const hero = latestHero.get(p.id);
    const cmap = userCaptains.get(p.id) || new Map();
    let totalCaptainPower = 0;
    for (const cs of cmap.values()) totalCaptainPower += Number(cs.power || 0);
    const artCount = (userArtifactsCount.get(p.id) || new Set()).size;
    const heroPower = Number(hero?.power || 0);
    const totalPower = totalCaptainPower + heroPower;
    return { p, hero, captainCount: cmap.size, totalCaptainPower, artCount, heroPower, totalPower };
  }).sort((a, b) => b.totalPower - a.totalPower);

  container.innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Hero</th>
          <th>Hero power</th>
          <th>Captains</th>
          <th>Captain power</th>
          <th>Artifacts</th>
          <th>Total power</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(r.p.username)}${r.p.is_admin ? ' <span style="color:var(--gold);font-size:11px;">(admin)</span>' : ""}</td>
            <td>${r.hero ? escapeHtml(r.hero.hero_name) : "—"}</td>
            <td>${fmtNum(r.heroPower) || "—"}</td>
            <td>${r.captainCount}</td>
            <td>${fmtNum(r.totalCaptainPower)}</td>
            <td>${r.artCount}</td>
            <td><strong>${fmtNum(r.totalPower)}</strong></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <p class="muted" style="margin-top:14px;font-size:13px;">Total power = sum of latest captain powers + latest hero power. Artifacts not included since they don't have a power score.</p>
  `;
}

// ------------------------------------------------------
// Admin modal — change signup code, manage users
// ------------------------------------------------------
async function openAdminModal() {
  if (!state.profile?.is_admin) return;

  const { data: settings } = await sb.from("group_settings").select("signup_code").eq("id", 1).single();

  openModal(`
    <h3>Admin</h3>
    <div class="field">
      <label>Group signup code</label>
      <input id="m-code" value="${escapeHtml(settings?.signup_code || "")}"/>
      <button class="ghost-btn small" id="m-save-code" style="margin-top:6px;">Save code</button>
    </div>
    <div class="field">
      <label>Members</label>
      <div id="m-members" style="max-height:200px;overflow-y:auto;"></div>
    </div>
    <div class="modal-actions">
      <button class="primary-btn" id="m-close">Close</button>
    </div>
  `);

  $("#m-close").addEventListener("click", closeModal);
  $("#m-save-code").addEventListener("click", async () => {
    const newCode = $("#m-code").value.trim();
    if (!newCode) return alert("Code can't be empty.");
    const { error } = await sb.from("group_settings")
      .update({ signup_code: newCode, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) return alert(error.message);
    alert("Code updated.");
  });

  const membersEl = $("#m-members");
  membersEl.innerHTML = state.profiles.map(p => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
      <span>${escapeHtml(p.username)}${p.is_admin ? ' <span style="color:var(--gold);">(admin)</span>' : ""}</span>
      <span>
        ${p.id !== state.user.id ? `
          <button class="ghost-btn small" data-toggle-admin="${p.id}" data-was="${p.is_admin}">${p.is_admin ? "Remove admin" : "Make admin"}</button>
          <button class="danger-btn small" data-remove="${p.id}">Remove</button>
        ` : '<span class="muted">(you)</span>'}
      </span>
    </div>
  `).join("");

  membersEl.querySelectorAll("[data-toggle-admin]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.toggleAdmin;
      const newVal = btn.dataset.was !== "true";
      const { error } = await sb.from("profiles").update({ is_admin: newVal }).eq("id", id);
      if (error) return alert(error.message);
      await loadAllProfiles();
      openAdminModal(); // re-render
    });
  });

  membersEl.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.remove;
      if (!confirm("Remove this member and all their data? This is permanent.")) return;
      const { error } = await sb.from("profiles").delete().eq("id", id);
      if (error) return alert(error.message);
      await loadAllProfiles();
      openAdminModal();
    });
  });
}

// ------------------------------------------------------
// Boot
// ------------------------------------------------------
boot();
