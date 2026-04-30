// =====================================================
// Total Battle tracker — v2 (fixed roster + survey form)
// =====================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/config.js";

if (SUPABASE_URL.startsWith("PASTE_") || SUPABASE_ANON_KEY.startsWith("PASTE_")) {
  document.body.innerHTML = `<div style="padding:40px;text-align:center;font-family:Georgia,serif;color:#e8dcc4;">
    <h2 style="color:#c9a14a;">Setup needed</h2>
    <p>Edit <code>public/config.js</code> and paste your Supabase URL and anon key.</p></div>`;
  throw new Error("Supabase config missing.");
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// Caps (validation)
const CAPS = {
  captain: { level: 600, stars: 7 },
  artifact: { level: 60, stars: 5, petals: 4 },
  hero: { level: 600, stars: 7 }
};

// ------------------------------------------------------
// State
// ------------------------------------------------------
const state = {
  user: null,
  profile: null,
  activeTab: "my-roster",
  filterUserId: null,
  profiles: [],
  captainRoster: [],   // [{id, name, sort_order, is_custom}]
  artifactRoster: [],  // [{id, name, sort_order}]
  signupMode: false
};

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function viewedUserId() { return state.filterUserId || state.user.id; }

// ------------------------------------------------------
// Auth (unchanged from v1)
// ------------------------------------------------------
function setAuthMode(mode) {
  state.signupMode = mode === "signup";
  $("#auth-title").textContent = state.signupMode ? "Create account" : "Sign in";
  $("#auth-sub").textContent = state.signupMode ? "Forge your name in the ledger." : "Welcome back, captain.";
  $("#auth-submit").textContent = state.signupMode ? "Create account" : "Sign in";
  $("#auth-toggle-text").textContent = state.signupMode ? "Already have an account?" : "No account?";
  $("#auth-toggle-link").textContent = state.signupMode ? "Sign in" : "Sign up";
  $$(".signup-only").forEach(el => state.signupMode ? show(el) : hide(el));
  hide($("#auth-msg"));
}

function showAuthMsg(text, kind = "error") {
  const el = $("#auth-msg");
  el.textContent = text;
  el.className = `msg ${kind}`;
}

async function handleAuthSubmit() {
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  if (!email || !password) return showAuthMsg("Email and password required.");
  const btn = $("#auth-submit");
  btn.disabled = true;
  try {
    if (state.signupMode) {
      const username = $("#auth-username").value.trim();
      const code = $("#auth-code").value.trim();
      if (!username || username.length < 2) return showAuthMsg("Username must be at least 2 characters.");
      if (!code) return showAuthMsg("Group code required.");

      const { data: codeOk, error: codeErr } = await sb.rpc("verify_signup_code", { code_attempt: code });
      if (codeErr) return showAuthMsg("Could not verify code: " + codeErr.message);
      if (!codeOk) return showAuthMsg("Invalid group code.");

      const { error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
      if (error) return showAuthMsg(error.message);
      showAuthMsg("Check your email to confirm your account.", "info");
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return showAuthMsg(error.message);
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

function showAuthScreen() {
  show($("#auth-screen"));
  hide($("#main-screen"));
  hide($("#user-bar"));
}

// ------------------------------------------------------
// Boot
// ------------------------------------------------------
async function boot() {
  $("#auth-submit").addEventListener("click", handleAuthSubmit);
  $("#auth-toggle-link").addEventListener("click", e => { e.preventDefault(); setAuthMode(state.signupMode ? "signin" : "signup"); });
  $("#signout-btn").addEventListener("click", handleSignOut);
  $("#admin-btn").addEventListener("click", openAdminModal);

  $$(".tab").forEach(tab => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  $("#user-filter").addEventListener("change", e => {
    state.filterUserId = e.target.value === "me" ? null : e.target.value;
    refreshActiveTab();
  });

  $("#save-captains-btn").addEventListener("click", saveCaptainsForm);
  $("#save-captains-btn-2").addEventListener("click", saveCaptainsForm);
  $("#save-artifacts-btn").addEventListener("click", saveArtifactsForm);
  $("#save-artifacts-btn-2").addEventListener("click", saveArtifactsForm);

  setAuthMode("signin");

  const { data } = await sb.auth.getSession();
  if (data.session) await loadProfileAndApp();
  else showAuthScreen();

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) await loadProfileAndApp();
    else if (event === "SIGNED_OUT") showAuthScreen();
  });
}

async function loadProfileAndApp() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return showAuthScreen();
  state.user = user;

  let profile = null;
  for (let i = 0; i < 5; i++) {
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
    if (data) { profile = data; break; }
    await new Promise(r => setTimeout(r, 400));
  }
  if (!profile) return showAuthMsg("Profile not found. Sign out and back in.", "error");
  state.profile = profile;

  hide($("#auth-screen"));
  show($("#main-screen"));
  show($("#user-bar"));
  $("#user-display").textContent = profile.username;
  if (profile.is_admin) show($("#admin-btn")); else hide($("#admin-btn"));

  await Promise.all([loadAllProfiles(), loadRosters()]);
  await refreshActiveTab();
}

async function loadAllProfiles() {
  const { data } = await sb.from("profiles").select("id, username, is_admin").order("username");
  state.profiles = data || [];
  const sel = $("#user-filter");
  sel.innerHTML = `<option value="me">My roster</option>` +
    state.profiles.filter(p => p.id !== state.user.id)
      .map(p => `<option value="${p.id}">${escapeHtml(p.username)}</option>`).join("");
}

async function loadRosters() {
  const [c, a] = await Promise.all([
    sb.from("captain_roster").select("*").order("sort_order"),
    sb.from("artifact_roster").select("*").order("sort_order")
  ]);
  state.captainRoster = c.data || [];
  state.artifactRoster = a.data || [];
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
    case "my-roster": return renderMyRoster();
    case "update-captains": return renderCaptainsForm();
    case "update-artifacts": return renderArtifactsForm();
    case "compare": return renderCompare();
  }
}

// ------------------------------------------------------
// Fetch latest snapshots for a user
// ------------------------------------------------------
async function getLatestSnapshots(userId) {
  // Use Promise.all to parallelize
  const [cap, art, hero] = await Promise.all([
    sb.from("captain_snapshots").select("*").eq("user_id", userId).order("recorded_at", { ascending: false }),
    sb.from("artifact_snapshots").select("*").eq("user_id", userId).order("recorded_at", { ascending: false }),
    sb.from("hero_snapshots").select("*").eq("user_id", userId).order("recorded_at", { ascending: false })
  ]);

  // Group by captain_id / artifact_id, taking the first (latest) for each
  const latestCaptain = new Map();
  for (const s of cap.data || []) {
    if (!latestCaptain.has(s.captain_id)) latestCaptain.set(s.captain_id, s);
  }
  const latestArtifact = new Map();
  for (const s of art.data || []) {
    if (!latestArtifact.has(s.artifact_id)) latestArtifact.set(s.artifact_id, s);
  }
  const latestHero = (hero.data || [])[0] || null;

  // Also keep all history for sparkline
  const captainHistory = new Map(); // id -> [snapshots desc]
  for (const s of cap.data || []) {
    if (!captainHistory.has(s.captain_id)) captainHistory.set(s.captain_id, []);
    captainHistory.get(s.captain_id).push(s);
  }
  const artifactHistory = new Map();
  for (const s of art.data || []) {
    if (!artifactHistory.has(s.artifact_id)) artifactHistory.set(s.artifact_id, []);
    artifactHistory.get(s.artifact_id).push(s);
  }

  return { latestCaptain, latestArtifact, latestHero, captainHistory, artifactHistory, heroHistory: hero.data || [] };
}

// ------------------------------------------------------
// MY ROSTER tab — show latest level/stars per item
// ------------------------------------------------------
async function renderMyRoster() {
  const userId = viewedUserId();
  const data = await getLatestSnapshots(userId);

  // Hero
  const heroEl = $("#hero-card-container");
  if (data.latestHero) {
    heroEl.innerHTML = `
      <div class="card-grid">
        ${renderItemCard({
          name: "Hero",
          latest: data.latestHero,
          history: data.heroHistory,
          kind: "hero"
        })}
      </div>`;
  } else {
    heroEl.innerHTML = `<div class="empty-state">No hero recorded yet.${userId === state.user.id ? " Use the Update tab." : ""}</div>`;
  }

  // Captains
  const capList = $("#captains-list");
  if (data.latestCaptain.size === 0) {
    capList.innerHTML = `<div class="empty-state">No captains recorded yet.${userId === state.user.id ? " Use the Update tab." : ""}</div>`;
  } else {
    capList.innerHTML = state.captainRoster
      .filter(r => data.latestCaptain.has(r.id))
      .map(r => renderItemCard({
        name: r.name,
        latest: data.latestCaptain.get(r.id),
        history: data.captainHistory.get(r.id) || [],
        kind: "captain"
      })).join("");
  }

  // Artifacts
  const artList = $("#artifacts-list");
  if (data.latestArtifact.size === 0) {
    artList.innerHTML = `<div class="empty-state">No artifacts recorded yet.${userId === state.user.id ? " Use the Update tab." : ""}</div>`;
  } else {
    artList.innerHTML = state.artifactRoster
      .filter(r => data.latestArtifact.has(r.id))
      .map(r => renderItemCard({
        name: r.name,
        latest: data.latestArtifact.get(r.id),
        history: data.artifactHistory.get(r.id) || [],
        kind: "artifact"
      })).join("");
  }
}

function renderItemCard({ name, latest, history, kind }) {
  const prev = history[1];
  const levelDelta = (prev && latest.level != null && prev.level != null)
    ? latest.level - prev.level : 0;
  const starsDelta = (prev && latest.stars != null && prev.stars != null)
    ? latest.stars - prev.stars : 0;

  const deltaTag = (d) => d > 0 ? ` <span class="delta-up">▲ ${d}</span>` : (d < 0 ? ` <span class="delta-down">▼ ${Math.abs(d)}</span>` : "");

  // Artifacts: show stars as "4★ + 1 petal" combined
  let starsRow;
  if (kind === "artifact") {
    const starsText = `${latest.stars ?? "—"}${latest.petals != null && latest.petals > 0 ? ` + ${latest.petals}/5` : ""}`;
    starsRow = `<div class="stat-row"><span class="lbl">Stars</span><span>${starsText}${deltaTag(starsDelta)}</span></div>`;
  } else {
    starsRow = `<div class="stat-row"><span class="lbl">Stars</span><span>${latest.stars ?? "—"}${deltaTag(starsDelta)}</span></div>`;
  }

  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-name">${escapeHtml(name)}</div></div>
      </div>
      <div class="stat-row"><span class="lbl">Level</span><span>${latest.level ?? "—"}${deltaTag(levelDelta)}</span></div>
      ${starsRow}
      <div class="stat-row" style="margin-top:6px;"><span class="lbl">Updated</span><span>${fmtDate(latest.recorded_at)}</span></div>
      ${renderSparkline(history)}
      ${history.length > 1 ? `<div class="card-actions">
        <button class="ghost-btn small" onclick="window.tbShowHistory('${kind}', ${latest[kind === 'hero' ? 'id' : kind+'_id'] || 'null'}, '${escapeHtml(name)}')">History (${history.length})</button>
      </div>` : ""}
    </div>`;
}

function renderSparkline(history) {
  if (!history || history.length < 2) return "";
  const values = history.slice().reverse().map(s => Number(s.level || 0));
  if (values.length < 2 || values.every(v => v === values[0])) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 260, h = 36;
  const stepX = w / (values.length - 1);
  const points = values.map((v, i) => `${(i*stepX).toFixed(1)},${(h - ((v-min)/range)*h).toFixed(1)}`).join(" ");
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline fill="none" stroke="var(--gold)" stroke-width="1.5" points="${points}"/></svg>`;
}

// History modal
window.tbShowHistory = async function(kind, id, name) {
  // Refetch full history for this item
  const tableMap = { captain: "captain_snapshots", artifact: "artifact_snapshots", hero: "hero_snapshots" };
  const fkMap = { captain: "captain_id", artifact: "artifact_id" };
  let q = sb.from(tableMap[kind]).select("*").eq("user_id", viewedUserId()).order("recorded_at", { ascending: false });
  if (kind !== "hero") q = q.eq(fkMap[kind], id);
  const { data } = await q;
  const rows = (data || []).map((h, i) => {
    const next = data[i+1];
    let delta = "";
    if (next && h.level != null && next.level != null) {
      const d = h.level - next.level;
      if (d > 0) delta = `<span class="delta-up">+${d}</span>`;
      else if (d < 0) delta = `<span class="delta-down">${d}</span>`;
    }
    return `<div class="history-row"><span>${fmtDate(h.recorded_at)}</span><span>L ${h.level ?? "—"} · ★ ${h.stars ?? "—"} ${delta}</span></div>`;
  }).join("");
  $("#modal").innerHTML = `<h3>${escapeHtml(name)} — history</h3>
    <div class="history-list">${rows}</div>
    <div class="modal-actions"><button class="primary-btn" onclick="document.getElementById('modal-backdrop').classList.add('hidden')">Close</button></div>`;
  show($("#modal-backdrop"));
};

$("#modal-backdrop").addEventListener("click", e => {
  if (e.target.id === "modal-backdrop") hide($("#modal-backdrop"));
});

// ------------------------------------------------------
// UPDATE CAPTAINS tab — Hero + Captains survey
// ------------------------------------------------------
async function renderCaptainsForm() {
  const data = await getLatestSnapshots(state.user.id);
  const container = $("#captains-form-container");

  const heroLatest = data.latestHero;
  const heroSection = `
    <div class="survey-section">
      <h3 class="section-h">Hero</h3>
      <div class="survey-header">
        <span></span><span class="col-r">Level</span><span class="col-r">Stars</span>
      </div>
      <div class="survey-row" data-kind="hero" data-id="hero">
        <div>
          <div class="row-label">Hero</div>
          ${heroLatest ? `<span class="row-last">Last: L${heroLatest.level ?? "—"} · ★${heroLatest.stars ?? "—"} · ${fmtDate(heroLatest.recorded_at)}</span>` : `<span class="row-last">No entries yet</span>`}
        </div>
        <input type="number" min="1" max="${CAPS.hero.level}" step="1" data-field="level" value="${heroLatest?.level ?? ""}" placeholder="—" />
        <input type="number" min="1" max="${CAPS.hero.stars}" step="1" data-field="stars" value="${heroLatest?.stars ?? ""}" placeholder="—" />
      </div>
    </div>`;

  const captainsSection = `
    <div class="survey-section">
      <h3 class="section-h">Captains</h3>
      <div class="survey-header">
        <span></span><span class="col-r">Level (1-${CAPS.captain.level})</span><span class="col-r">Stars (1-${CAPS.captain.stars})</span>
      </div>
      ${state.captainRoster.map(r => {
        const latest = data.latestCaptain.get(r.id);
        return `<div class="survey-row" data-kind="captain" data-id="${r.id}">
          <div>
            <div class="row-label">${escapeHtml(r.name)}</div>
            ${latest ? `<span class="row-last">Last: L${latest.level ?? "—"} · ★${latest.stars ?? "—"} · ${fmtDate(latest.recorded_at)}</span>` : `<span class="row-last">No entries yet</span>`}
          </div>
          <input type="number" min="1" max="${CAPS.captain.level}" step="1" data-field="level" value="${latest?.level ?? ""}" placeholder="—" />
          <input type="number" min="1" max="${CAPS.captain.stars}" step="1" data-field="stars" value="${latest?.stars ?? ""}" placeholder="—" />
        </div>`;
      }).join("")}
    </div>`;

  container.innerHTML = heroSection + captainsSection;
  container.querySelectorAll("input[type=number]").forEach(input => {
    input.addEventListener("input", () => validateInput(input));
    input.addEventListener("blur", () => validateInput(input));
  });
}

// ------------------------------------------------------
// UPDATE ARTIFACTS tab
// ------------------------------------------------------
async function renderArtifactsForm() {
  const data = await getLatestSnapshots(state.user.id);
  const container = $("#artifacts-form-container");

  container.innerHTML = `
    <div class="survey-section">
      <h3 class="section-h">Artifacts</h3>
      <div class="survey-header survey-header-3">
        <span></span>
        <span class="col-r">Level (1-${CAPS.artifact.level})</span>
        <span class="col-r">Stars (0-${CAPS.artifact.stars})</span>
        <span class="col-r">Petals (0-${CAPS.artifact.petals})</span>
      </div>
      ${state.artifactRoster.map(r => {
        const latest = data.latestArtifact.get(r.id);
        const lastSummary = latest
          ? `Last: L${latest.level ?? "—"} · ${latest.stars ?? "—"}★${latest.petals != null && latest.petals > 0 ? ` +${latest.petals}p` : ""} · ${fmtDate(latest.recorded_at)}`
          : "No entries yet";
        return `<div class="survey-row survey-row-3" data-kind="artifact" data-id="${r.id}">
          <div>
            <div class="row-label">${escapeHtml(r.name)}</div>
            <span class="row-last">${lastSummary}</span>
          </div>
          <input type="number" min="1" max="${CAPS.artifact.level}" step="1" data-field="level" value="${latest?.level ?? ""}" placeholder="—" />
          <input type="number" min="0" max="${CAPS.artifact.stars}" step="1" data-field="stars" value="${latest?.stars ?? ""}" placeholder="—" />
          <input type="number" min="0" max="${CAPS.artifact.petals}" step="1" data-field="petals" value="${latest?.petals ?? ""}" placeholder="0" />
        </div>`;
      }).join("")}
    </div>`;

  container.querySelectorAll("input[type=number]").forEach(input => {
    input.addEventListener("input", () => validateInput(input));
    input.addEventListener("blur", () => validateInput(input));
  });
}

function validateInput(input) {
  const val = input.value.trim();
  if (val === "") { input.classList.remove("invalid"); return true; }
  const n = Number(val);
  const min = Number(input.min);
  const max = Number(input.max);
  if (!Number.isInteger(n) || n < min || n > max) {
    input.classList.add("invalid");
    return false;
  }
  input.classList.remove("invalid");
  return true;
}

async function saveCaptainsForm() {
  const rows = $$("#captains-form-container .survey-row");
  await processSave(rows, "save-captains-msg", () => renderCaptainsForm());
}

async function saveArtifactsForm() {
  const rows = $$("#artifacts-form-container .survey-row");
  await processSave(rows, "save-artifacts-msg", () => renderArtifactsForm());
}

async function processSave(rows, msgElId, refreshFn) {
  const inserts = { captain: [], artifact: [], hero: [] };
  let invalidCount = 0;
  const data = await getLatestSnapshots(state.user.id);

  for (const row of rows) {
    const kind = row.dataset.kind;
    const id = row.dataset.id;
    const levelInput = row.querySelector('[data-field="level"]');
    const starsInput = row.querySelector('[data-field="stars"]');
    const petalsInput = row.querySelector('[data-field="petals"]');

    if (!validateInput(levelInput) || !validateInput(starsInput) || (petalsInput && !validateInput(petalsInput))) {
      invalidCount++;
      continue;
    }

    const lvlRaw = levelInput.value.trim();
    const starsRaw = starsInput.value.trim();
    const petalsRaw = petalsInput ? petalsInput.value.trim() : "";

    if (lvlRaw === "" && starsRaw === "" && petalsRaw === "") continue;

    const level = lvlRaw === "" ? null : Number(lvlRaw);
    const stars = starsRaw === "" ? null : Number(starsRaw);
    const petals = petalsRaw === "" ? null : Number(petalsRaw);

    let prev = null;
    if (kind === "hero") prev = data.latestHero;
    else if (kind === "captain") prev = data.latestCaptain.get(Number(id));
    else if (kind === "artifact") prev = data.latestArtifact.get(Number(id));

    if (prev && prev.level === level && prev.stars === stars) {
      if (kind === "artifact") {
        if ((prev.petals ?? null) === petals) continue;
      } else {
        continue;
      }
    }

    if (kind === "hero") {
      inserts.hero.push({ user_id: state.user.id, level, stars });
    } else if (kind === "captain") {
      inserts.captain.push({ user_id: state.user.id, captain_id: Number(id), level, stars });
    } else if (kind === "artifact") {
      inserts.artifact.push({ user_id: state.user.id, artifact_id: Number(id), level, stars, petals });
    }
  }

  const msgEl = document.getElementById(msgElId);
  msgEl.classList.remove("hidden", "error", "info");
  msgEl.classList.add("msg");

  if (invalidCount > 0) {
    msgEl.textContent = `${invalidCount} field(s) have invalid values. Check the highlighted rows.`;
    msgEl.classList.add("error");
    return;
  }

  const totalInserts = inserts.captain.length + inserts.artifact.length + inserts.hero.length;
  if (totalInserts === 0) {
    msgEl.textContent = "No changes to save.";
    msgEl.classList.add("info");
    return;
  }

  const promises = [];
  if (inserts.captain.length) promises.push(sb.from("captain_snapshots").insert(inserts.captain));
  if (inserts.artifact.length) promises.push(sb.from("artifact_snapshots").insert(inserts.artifact));
  if (inserts.hero.length) promises.push(sb.from("hero_snapshots").insert(inserts.hero));

  const results = await Promise.all(promises);
  const errors = results.filter(r => r.error);
  if (errors.length) {
    msgEl.textContent = "Save failed: " + errors[0].error.message;
    msgEl.classList.add("error");
    return;
  }

  msgEl.textContent = `Saved ${totalInserts} update(s).`;
  msgEl.classList.add("info");
  setTimeout(() => refreshFn(), 800);
}

// ------------------------------------------------------
// COMPARE tab
// ------------------------------------------------------
async function renderCompare() {
  const container = $("#compare-content");
  container.innerHTML = `<div class="muted">Loading…</div>`;

  // Fetch all latest per user
  const [capRes, artRes, heroRes] = await Promise.all([
    sb.from("captain_snapshots").select("*").order("recorded_at", { ascending: false }),
    sb.from("artifact_snapshots").select("*").order("recorded_at", { ascending: false }),
    sb.from("hero_snapshots").select("*").order("recorded_at", { ascending: false })
  ]);

  // Latest per (user, captain_id)
  const userCaptain = new Map(); // userId -> Map(captainId -> snapshot)
  for (const s of capRes.data || []) {
    if (!userCaptain.has(s.user_id)) userCaptain.set(s.user_id, new Map());
    const m = userCaptain.get(s.user_id);
    if (!m.has(s.captain_id)) m.set(s.captain_id, s);
  }

  const userArtifact = new Map();
  for (const s of artRes.data || []) {
    if (!userArtifact.has(s.user_id)) userArtifact.set(s.user_id, new Map());
    const m = userArtifact.get(s.user_id);
    if (!m.has(s.artifact_id)) m.set(s.artifact_id, s);
  }

  const userHero = new Map();
  for (const s of heroRes.data || []) {
    if (!userHero.has(s.user_id)) userHero.set(s.user_id, s);
  }

  // Hero leaderboard
  const heroBoard = state.profiles.map(p => ({
    user: p,
    snap: userHero.get(p.id)
  })).filter(r => r.snap).sort((a, b) => (b.snap.level || 0) - (a.snap.level || 0));

  // Captain matrix
  const captainHeader = state.captainRoster.map(c => `<th>${escapeHtml(c.name)}</th>`).join("");
  const captainRows = state.profiles.map(p => {
    const cm = userCaptain.get(p.id) || new Map();
    const cells = state.captainRoster.map(c => {
      const snap = cm.get(c.id);
      if (!snap) return `<td class="muted">—</td>`;
      return `<td>L${snap.level ?? "—"} · ★${snap.stars ?? "—"}</td>`;
    }).join("");
    return `<tr><td><strong>${escapeHtml(p.username)}</strong></td>${cells}</tr>`;
  }).join("");

  // Artifact matrix
  const artifactHeader = state.artifactRoster.map(a => `<th>${escapeHtml(a.name)}</th>`).join("");
  const artifactRows = state.profiles.map(p => {
    const am = userArtifact.get(p.id) || new Map();
    const cells = state.artifactRoster.map(a => {
      const snap = am.get(a.id);
      if (!snap) return `<td class="muted">—</td>`;
      const petalSuffix = snap.petals != null && snap.petals > 0 ? `+${snap.petals}p` : "";
      return `<td>L${snap.level ?? "—"} · ${snap.stars ?? "—"}★${petalSuffix}</td>`;
    }).join("");
    return `<tr><td><strong>${escapeHtml(p.username)}</strong></td>${cells}</tr>`;
  }).join("");

  container.innerHTML = `
    <h3 class="section-h">Hero leaderboard</h3>
    ${heroBoard.length === 0 ? `<div class="empty-state">No hero data yet.</div>` : `
      <table class="compare-table">
        <thead><tr><th>#</th><th>Player</th><th>Hero level</th><th>Stars</th><th>Updated</th></tr></thead>
        <tbody>${heroBoard.map((r, i) => `
          <tr><td>${i+1}</td><td><strong>${escapeHtml(r.user.username)}</strong></td>
          <td>${r.snap.level ?? "—"}</td><td>${r.snap.stars ?? "—"}</td><td>${fmtDate(r.snap.recorded_at)}</td></tr>
        `).join("")}</tbody>
      </table>`}

    <h3 class="section-h">Captains</h3>
    <div style="overflow-x:auto;">
      <table class="compare-table">
        <thead><tr><th>Player</th>${captainHeader}</tr></thead>
        <tbody>${captainRows}</tbody>
      </table>
    </div>

    <h3 class="section-h">Artifacts</h3>
    <div style="overflow-x:auto;">
      <table class="compare-table">
        <thead><tr><th>Player</th>${artifactHeader}</tr></thead>
        <tbody>${artifactRows}</tbody>
      </table>
    </div>
  `;
}

// ------------------------------------------------------
// ADMIN modal — change signup code, manage users
// ------------------------------------------------------
async function openAdminModal() {
  if (!state.profile?.is_admin) return;

  const { data: settings } = await sb.from("group_settings").select("signup_code").eq("id", 1).single();

  $("#modal").innerHTML = `
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
  `;
  show($("#modal-backdrop"));

  $("#m-close").addEventListener("click", () => hide($("#modal-backdrop")));
  $("#m-save-code").addEventListener("click", async () => {
    const newCode = $("#m-code").value.trim();
    if (!newCode) return alert("Code can't be empty.");
    const { error } = await sb.from("group_settings")
      .update({ signup_code: newCode, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return alert(error.message);
    alert("Code updated.");
  });

  const membersEl = $("#m-members");
  membersEl.innerHTML = state.profiles.map(p => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
      <span>${escapeHtml(p.username)}${p.is_admin ? ' <span style="color:var(--gold);">(admin)</span>' : ""}</span>
      <span>${p.id !== state.user.id ? `
        <button class="ghost-btn small" data-toggle-admin="${p.id}" data-was="${p.is_admin}">${p.is_admin ? "Remove admin" : "Make admin"}</button>
        <button class="danger-btn small" data-remove="${p.id}">Remove</button>
      ` : '<span class="muted">(you)</span>'}</span>
    </div>
  `).join("");

  membersEl.querySelectorAll("[data-toggle-admin]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.toggleAdmin;
      const newVal = btn.dataset.was !== "true";
      const { error } = await sb.from("profiles").update({ is_admin: newVal }).eq("id", id);
      if (error) return alert(error.message);
      await loadAllProfiles();
      openAdminModal();
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

boot();
