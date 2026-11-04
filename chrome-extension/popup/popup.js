"use strict";

const DEFAULTS = { apiUrl: "http://localhost:8000", includeReplies: false, target: 200, theme: null };
const CHUNK_SIZE = 100;      // commentaires par requête (l'API accepte jusqu'à 500)
const CONCURRENCY = 3;       // requêtes en parallèle
const PAGE_SIZE = 50;        // éléments rendus à la fois dans la liste
const MAX_CHARS = 5000;      // limite de l'API par commentaire
const REQUEST_TIMEOUT = 20000;
const CACHE_LIMIT = 3000;
const NAMES = { positive: "Positif", neutral: "Neutre", negative: "Négatif" };

const $ = (id) => document.getElementById(id);
const state = { settings: { ...DEFAULTS }, items: [], filter: "all", query: "", sort: "order", shown: PAGE_SIZE, busy: false, title: "" };

/* ---------- Utilitaires ---------- */
const store = {
  get: (area, key) => new Promise((res) => chrome.storage[area].get(key, (v) => res(v?.[key]))),
  set: (area, key, val) => new Promise((res) => chrome.storage[area].set({ [key]: val }, res)),
};
const sentimentOf = (label) => (label > 0 ? "positive" : label < 0 ? "negative" : "neutral");

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.id);
  toast.id = setTimeout(() => (t.hidden = true), 1800);
}

function setStatus(kind, msg) {
  const s = $("status");
  if (!msg) { s.hidden = true; return; }
  s.hidden = false; s.className = `status ${kind}`; s.textContent = msg;
}

function setBusy(busy) {
  state.busy = busy;
  $("analyzeBtn").disabled = busy;
  $("loadMoreBtn").disabled = busy;
}

function setProgress(ratio) {
  $("progress").hidden = ratio == null;
  if (ratio != null) $("progressBar").style.width = `${Math.round(ratio * 100)}%`;
}

/* ---------- Thème & paramètres ---------- */
function applyTheme(theme) {
  const t = theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
  return t;
}

async function loadSettings() {
  const saved = (await store.get("local", "settings")) || {};
  state.settings = { ...DEFAULTS, ...saved };
  applyTheme(state.settings.theme);
  $("apiUrl").value = state.settings.apiUrl;
  $("includeReplies").checked = state.settings.includeReplies;
  $("target").value = state.settings.target;
}

const saveSettings = () => store.set("local", "settings", state.settings);

/* ---------- API ---------- */
const apiBase = () => state.settings.apiUrl.replace(/\/+$/, "");

async function apiFetch(path, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(apiBase() + path, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      let detail = `Erreur ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body.detail === "string") detail = body.detail;
        if (body.errors?.length) detail += ` : ${body.errors.map((e) => e.message).join("; ")}`;
      } catch { /* corps non JSON */ }
      const err = new Error(detail); err.status = res.status; throw err;
    }
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("L'API ne répond pas (délai dépassé).");
    if (e.name === "TypeError") throw new Error(`API injoignable (${apiBase()}). Le serveur est-il démarré ?`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  const dot = $("apiDot");
  try {
    const h = await apiFetch("/health");
    dot.className = `dot ${h.model_loaded ? "ok" : "ko"}`;
    dot.title = h.model_loaded ? `API OK (${h.model_type})` : "API démarrée mais modèle non chargé";
    return h.model_loaded;
  } catch (e) {
    dot.className = "dot ko"; dot.title = e.message;
    return false;
  }
}

/** Envoie les commentaires par lots, avec un nombre limité de requêtes simultanées. */
async function predictAll(texts, onProgress) {
  const chunks = [];
  for (let i = 0; i < texts.length; i += CHUNK_SIZE) chunks.push(texts.slice(i, i + CHUNK_SIZE));
  const out = new Array(chunks.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      const data = await apiFetch("/predict_batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: chunks[i] }),
      });
      out[i] = data.predictions;
      onProgress(++done / chunks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return out.flat();
}

/* ---------- Onglet / content script ---------- */
async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/www\.youtube\.com\/watch/.test(tab.url)) {
    throw new Error("Ouvrez une vidéo YouTube (page de lecture) pour analyser ses commentaires.");
  }
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    // onglet ouvert avant l'installation de l'extension : injection à la demande
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/content.js"] });
  }
}

const send = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg);

/* ---------- Analyse ---------- */
async function analyze({ loadMore = false } = {}) {
  if (state.busy) return;
  setBusy(true);
  try {
    const tab = await getTab();
    await ensureContentScript(tab.id);
    const options = { includeReplies: state.settings.includeReplies };

    if (loadMore) {
      setStatus("loading", "Chargement de commentaires supplémentaires (défilement de la page)…");
      await send(tab.id, { type: "LOAD_MORE", options: { ...options, target: state.settings.target } });
    }

    setStatus("loading", "Extraction des commentaires…");
    const ex = await send(tab.id, { type: "EXTRACT", options });
    state.title = ex.title || "";
    $("videoTitle").textContent = state.title || "—";
    if (!ex.commentsSectionFound || ex.comments.length === 0) {
      $("results").hidden = true;
      setStatus("", ex.commentsSectionFound
        ? "Aucun commentaire chargé. Faites défiler la page ou cliquez sur « Charger plus »."
        : "Section commentaires introuvable. Faites défiler jusqu'aux commentaires puis réessayez.");
      return;
    }

    // Cache par vidéo : on n'envoie à l'API que les commentaires jamais analysés
    const cacheKey = `cache:${ex.videoId}`;
    const cache = (await store.get("session", cacheKey)) || {};
    const comments = ex.comments.map((c) => ({ ...c, text: c.text.slice(0, MAX_CHARS) }));
    const todo = [...new Set(comments.filter((c) => !cache[c.text]).map((c) => c.text))];

    if (todo.length) {
      setStatus("loading", `Analyse de ${todo.length} commentaire(s)…`);
      setProgress(0);
      const preds = await predictAll(todo, setProgress);
      preds.forEach((p, i) => { cache[todo[i]] = [p.label, p.confidence]; });
      const keys = Object.keys(cache);
      if (keys.length > CACHE_LIMIT) keys.slice(0, keys.length - CACHE_LIMIT).forEach((k) => delete cache[k]);
      await store.set("session", cacheKey, cache);
    }

    state.items = comments.map((c, i) => {
      const [label, confidence] = cache[c.text];
      return { i, text: c.text, author: c.author, isReply: c.isReply, label, confidence, sentiment: sentimentOf(label) };
    });
    state.shown = PAGE_SIZE;
    setStatus("", "");
    $("results").hidden = false;
    render();
  } catch (e) {
    setStatus("error", e.message || "Erreur inattendue.");
    checkHealth();
  } finally {
    setProgress(null);
    setBusy(false);
  }
}

/* ---------- Rendu ---------- */
function computeStats(items) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  let sum = 0, confSum = 0, confN = 0;
  items.forEach((it) => {
    counts[it.sentiment]++; sum += it.label;
    if (it.confidence > 0) { confSum += it.confidence; confN++; }
  });
  const total = items.length;
  const dominant = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return { counts, total, avg: total ? sum / total : 0, avgConf: confN ? confSum / confN : null, dominant };
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawDonut(counts, total) {
  const canvas = $("donut"), ctx = canvas.getContext("2d");
  const cx = 80, cy = 80, r = 64, w = 22;
  ctx.clearRect(0, 0, 160, 160);
  const parts = [["positive", cssVar("--pos")], ["neutral", cssVar("--neu")], ["negative", cssVar("--neg")]];
  let angle = -Math.PI / 2;
  ctx.lineWidth = w;
  parts.forEach(([k, color]) => {
    if (!counts[k]) return;
    const a = (counts[k] / total) * Math.PI * 2;
    ctx.beginPath(); ctx.strokeStyle = color; ctx.arc(cx, cy, r, angle, angle + a); ctx.stroke();
    angle += a;
  });
  if (!total) { ctx.beginPath(); ctx.strokeStyle = cssVar("--border"); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
}

function renderStats() {
  const s = computeStats(state.items);
  $("totalCount").textContent = s.total;
  drawDonut(s.counts, s.total);
  const bars = $("bars");
  bars.replaceChildren();
  [["positive", "--pos"], ["neutral", "--neu"], ["negative", "--neg"]].forEach(([k, v]) => {
    const pct = s.total ? (100 * s.counts[k]) / s.total : 0;
    const wrap = document.createElement("div");
    const label = document.createElement("div"); label.className = "bar-label";
    const name = document.createElement("span"); name.textContent = NAMES[k];
    const val = document.createElement("strong"); val.textContent = `${pct.toFixed(1)}% (${s.counts[k]})`;
    label.append(name, val);
    const track = document.createElement("div"); track.className = "bar-track";
    const fill = document.createElement("div"); fill.className = "bar-fill";
    fill.style.width = `${pct}%`; fill.style.background = cssVar(v);
    track.append(fill); wrap.append(label, track); bars.append(wrap);
  });
  $("avgScore").textContent = (s.avg > 0 ? "+" : "") + s.avg.toFixed(2);
  $("dominant").textContent = s.total ? NAMES[s.dominant] : "—";
  $("avgConf").textContent = s.avgConf == null ? "—" : `${Math.round(s.avgConf * 100)}%`;
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  let list = state.items.filter((it) =>
    (state.filter === "all" || it.sentiment === state.filter) && (!q || it.text.toLowerCase().includes(q)));
  const sorters = {
    conf: (a, b) => b.confidence - a.confidence,
    pos: (a, b) => b.label - a.label || b.confidence - a.confidence,
    neg: (a, b) => a.label - b.label || b.confidence - a.confidence,
  };
  if (sorters[state.sort]) list = [...list].sort(sorters[state.sort]);
  return list;
}

function renderList() {
  const items = visibleItems();
  const ul = $("list");
  ul.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li"); li.className = "empty"; li.textContent = "Aucun commentaire ne correspond.";
    ul.append(li);
  }
  const frag = document.createDocumentFragment();
  items.slice(0, state.shown).forEach((it) => {
    const li = document.createElement("li"); li.className = `item ${it.sentiment}`;
    const head = document.createElement("div"); head.className = "item-head";
    const badge = document.createElement("span"); badge.className = `badge ${it.sentiment}`; badge.textContent = NAMES[it.sentiment];
    const conf = document.createElement("span"); conf.className = "conf";
    conf.textContent = it.confidence > 0 ? `Confiance ${Math.round(it.confidence * 100)}%` : "Confiance —";
    const left = document.createElement("span"); left.append(badge);
    if (it.isReply) { const t = document.createElement("span"); t.className = "reply-tag"; t.textContent = "réponse"; left.append(t); }
    head.append(left, conf);
    const p = document.createElement("p"); p.className = "text"; p.textContent = it.text;   // textContent : pas d'injection HTML
    p.addEventListener("click", () => p.classList.toggle("open"));
    li.append(head, p); frag.append(li);
  });
  ul.append(frag);
  $("moreBtn").hidden = items.length <= state.shown;
  $("moreBtn").textContent = `Afficher plus (${items.length - state.shown} restants)`;
}

function render() { renderStats(); renderList(); }

/* ---------- Export ---------- */
function csvCell(v) {
  let s = String(v).replace(/\r?\n/g, " ");
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;           // neutralise l'injection de formules Excel
  return `"${s.replace(/"/g, '""')}"`;
}

function exportRows() { return visibleItems(); }

function download(name, mime, content) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyResults() {
  const rows = exportRows();
  const s = computeStats(state.items);
  const head = `${state.title}\n${s.total} commentaires — ` +
    `positifs ${((100 * s.counts.positive) / s.total).toFixed(1)}%, neutres ${((100 * s.counts.neutral) / s.total).toFixed(1)}%, ` +
    `négatifs ${((100 * s.counts.negative) / s.total).toFixed(1)}%\n`;
  const body = rows.map((r) => `[${NAMES[r.sentiment]} ${Math.round(r.confidence * 100)}%] ${r.text}`).join("\n");
  navigator.clipboard.writeText(head + "\n" + body).then(() => toast("Résultats copiés"), () => toast("Copie impossible"));
}

/* ---------- Événements ---------- */
function bind() {
  $("analyzeBtn").addEventListener("click", () => analyze());
  $("loadMoreBtn").addEventListener("click", () => analyze({ loadMore: true }));
  $("settingsBtn").addEventListener("click", () => { $("settings").hidden = !$("settings").hidden; });
  $("saveSettings").addEventListener("click", async () => {
    state.settings.apiUrl = $("apiUrl").value.trim() || DEFAULTS.apiUrl;
    await saveSettings(); toast(await checkHealth() ? "API joignable" : "API injoignable");
  });
  $("includeReplies").addEventListener("change", (e) => { state.settings.includeReplies = e.target.checked; saveSettings(); });
  $("target").addEventListener("change", (e) => {
    state.settings.target = Math.min(2000, Math.max(20, Number(e.target.value) || DEFAULTS.target)); saveSettings();
  });
  $("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    state.settings.theme = applyTheme(cur === "dark" ? "light" : "dark"); saveSettings();
    if (!$("results").hidden) renderStats();   // le canvas utilise les couleurs du thème
  });
  document.querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    state.filter = chip.dataset.filter; state.shown = PAGE_SIZE; renderList();
  }));
  let timer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = e.target.value; state.shown = PAGE_SIZE; renderList(); }, 200);
  });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; state.shown = PAGE_SIZE; renderList(); });
  $("moreBtn").addEventListener("click", () => { state.shown += PAGE_SIZE; renderList(); });
  $("copyBtn").addEventListener("click", copyResults);
  $("csvBtn").addEventListener("click", () => {
    const lines = ["index,auteur,reponse,sentiment,confiance,commentaire"].concat(exportRows().map((r) =>
      [r.i + 1, csvCell(r.author), r.isReply ? "oui" : "non", r.sentiment, r.confidence.toFixed(3), csvCell(r.text)].join(",")));
    download("youtube_sentiment.csv", "text/csv;charset=utf-8", "﻿" + lines.join("\n"));
  });
  $("jsonBtn").addEventListener("click", () => {
    const s = computeStats(state.items);
    download("youtube_sentiment.json", "application/json", JSON.stringify({
      video: state.title, statistics: s,
      comments: exportRows().map(({ i, text, author, isReply, sentiment, label, confidence }) =>
        ({ index: i + 1, text, author, isReply, sentiment, label, confidence })),
    }, null, 2));
  });
}

(async function init() {
  await loadSettings();
  bind();
  if (await checkHealth()) analyze();           // extraction + analyse automatiques des commentaires visibles
  else setStatus("error", `API injoignable ou modèle non chargé (${apiBase()}). Démarrez le serveur : uvicorn app.main:app`);
})();
