const DB = "wor-yt-uploader";
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(undefined);
  });
}
async function idbSet(key, val) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const $ = (id) => document.getElementById(id);
const setStatus = (msg, kind = "") => {
  const el = $("status");
  el.textContent = msg || "";
  el.className = kind;
};
const setProgress = (pct) => {
  const wrap = $("progressWrap");
  const bar = $("progress");
  if (pct == null) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  bar.style.width = Math.round(pct * 100) + "%";
};

let session = null;
function loadSession() {
  try { session = JSON.parse(sessionStorage.getItem("yt-session") || "null"); } catch { session = null; }
}
function saveSession(s) {
  session = s;
  if (s) sessionStorage.setItem("yt-session", JSON.stringify(s));
  else sessionStorage.removeItem("yt-session");
  updateConnLabel();
}
function tokenValid() {
  return !!(session?.access_token && session.expires_at && Date.now() < session.expires_at - 30000);
}
function updateConnLabel() {
  const el = $("connLabel");
  el.textContent = tokenValid() ? "Connected. Token stays in this browser about 1 hour." : "Not connected.";
  el.className = tokenValid() ? "hint ok" : "hint";
}

async function loadClientId() {
  const saved = await idbGet("client-id");
  if (saved) $("clientId").value = saved;
  return (saved || $("clientId").value || "").trim();
}
async function saveClientId() {
  const id = $("clientId").value.trim();
  if (!id) return setStatus("Paste a Client ID first.", "error");
  await idbSet("client-id", id);
  setStatus("Client ID saved in this browser.", "ok");
}

async function getToken(interactive = false) {
  if (tokenValid()) return session.access_token;
  const clientId = await loadClientId();
  if (!clientId) throw new Error("Save a Google OAuth Client ID first.");
  if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in script did not load. Reload the page.");
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      callback: (resp) => {
        if (resp?.error) return reject(new Error(resp.error_description || resp.error));
        saveSession({
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
        });
        listChannels().catch((e) => setStatus(String(e.message || e), "error"));
        resolve(resp.access_token);
      },
    });
    client.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

async function listChannels() {
  const token = await getToken(false);
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Channel list failed (${res.status})`);
  const items = data.items || [];
  const sel = $("channel");
  const saved = await idbGet("channel-id");
  sel.innerHTML = items.map((ch) =>
    `<option value="${ch.id}" ${ch.id === saved ? "selected" : ""}>${ch.snippet?.title || ch.id}</option>`
  ).join("") || `<option value="">No channels on this login</option>`;
  if (sel.value) await idbSet("channel-id", sel.value);
}

async function resumableUpload(file, meta, onPct) {
  const token = await getToken(false);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(file.size),
      "X-Upload-Content-Type": file.type || "video/mp4",
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) {
    const err = await init.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Start failed (${init.status})`);
  }
  const loc = init.headers.get("Location");
  if (!loc) throw new Error("No upload URL returned.");
  const chunk = 8 * 1024 * 1024;
  let start = 0;
  let last = null;
  while (start < file.size) {
    const end = Math.min(file.size, start + chunk);
    const slice = file.slice(start, end);
    const put = await fetch(loc, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "video/mp4",
        "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: slice,
    });
    if (put.status === 308) {
      start = end;
      if (onPct) onPct(start / file.size);
      continue;
    }
    if (!put.ok) {
      const err = await put.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Upload failed (${put.status})`);
    }
    last = await put.json();
    if (onPct) onPct(1);
    start = file.size;
  }
  return last;
}

async function addHistory(entry) {
  const hist = (await idbGet("history")) || [];
  hist.unshift(entry);
  await idbSet("history", hist.slice(0, 200));
  renderHistory();
}
async function renderHistory() {
  const hist = (await idbGet("history")) || [];
  const el = $("history");
  if (!hist.length) {
    el.innerHTML = `<p class="hint">No uploads yet.</p>`;
    return;
  }
  el.innerHTML = hist.map((h) => `
    <div class="hist-item">
      <div>
        <strong>${escapeHtml(h.title || "(no title)")}</strong>
        <div class="hist-meta">${escapeHtml(h.channel || "")} · ${new Date(h.at).toLocaleString()} · ${h.privacy}${h.scheduled ? " (scheduled)" : ""}</div>
      </div>
      <div>
        ${h.id ? `<a href="https://youtu.be/${h.id}" target="_blank" rel="noopener">Watch</a>` : ""}
      </div>
    </div>
  `).join("");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

let currentFile = null;
function setFile(f) {
  currentFile = f;
  $("fileName").textContent = f ? `${f.name} (${(f.size / 1e6).toFixed(1)} MB)` : "";
}

$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => setFile($("file").files?.[0] || null));
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("drag"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("drag"));
$("drop").addEventListener("drop", (e) => {
  e.preventDefault();
  $("drop").classList.remove("drag");
  const f = e.dataTransfer.files?.[0];
  if (f && f.type.startsWith("video/")) setFile(f);
});

$("saveClient").addEventListener("click", saveClientId);
$("connect").addEventListener("click", async () => {
  try {
    await saveClientId();
    await getToken(true);
    setStatus("Connected.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
});
$("disconnect").addEventListener("click", () => {
  saveSession(null);
  $("channel").innerHTML = `<option value="">Connect first</option>`;
  setStatus("Disconnected.", "ok");
});
$("channel").addEventListener("change", () => {
  if ($("channel").value) idbSet("channel-id", $("channel").value);
});

$("upload").addEventListener("click", async () => {
  if (!currentFile) return setStatus("Choose a video first.", "error");
  const title = $("title").value.trim();
  if (!title) return setStatus("Title is required.", "error");
  if (!tokenValid()) {
    try { await getToken(true); } catch (e) { return setStatus(String(e.message || e), "error"); }
  }
  const channelName = $("channel").selectedOptions[0]?.textContent || "";
  let privacy = $("privacy").value;
  const schedVal = $("schedule").value;
  let publishAt = "";
  if (schedVal) {
    const d = new Date(schedVal);
    if (d.getTime() > Date.now() + 60000) {
      publishAt = d.toISOString();
      privacy = "private";
    }
  }
  const tags = $("tags").value.split(/[,]+/).map((t) => t.trim()).filter(Boolean).slice(0, 15);
  const meta = {
    snippet: {
      title: title.slice(0, 100),
      description: $("description").value.slice(0, 5000),
      tags,
      categoryId: $("category").value,
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
      ...(publishAt ? { publishAt } : {}),
    },
  };
  setStatus("Uploading…");
  setProgress(0);
  $("upload").disabled = true;
  try {
    const video = await resumableUpload(currentFile, meta, setProgress);
    const entry = {
      at: Date.now(),
      title,
      channel: channelName,
      id: video?.id,
      privacy,
      scheduled: !!publishAt,
    };
    await addHistory(entry);
    setStatus(`Uploaded! Video ID: ${video?.id || "?"}`, "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  } finally {
    $("upload").disabled = false;
    setTimeout(() => setProgress(null), 1500);
  }
});

$("clearHistory").addEventListener("click", async () => {
  if (!confirm("Clear upload history in this browser?")) return;
  await idbSet("history", []);
  renderHistory();
});

(async function init() {
  loadSession();
  await loadClientId();
  updateConnLabel();
  renderHistory();
  if (tokenValid()) listChannels().catch(() => {});
})();
