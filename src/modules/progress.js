import {
  safeStorage as localStorage,
  readJSON,
} from "../../lib/safe-storage.js";
import { captureSession, onSessionReset } from "../../lib/session-scope.js";
import { withDeadline } from "../../lib/deadline.js";
import { getCurrentUser, getSupabaseClient } from "../services/supabase.js";

const STAT_KEY = "sh-stats",
  XP_KEY = "sh-xp";
let progressSyncTimer = null;
const XP_LEVELS = [
  { min: 0, name: "Жаңадан бастаушы", next: 100 },
  { min: 100, name: "Оқушы", next: 300 },
  { min: 300, name: "Білгір", next: 600 },
  { min: 600, name: "Данышпан", next: 1000 },
  { min: 1000, name: "Шебер", next: 1500 },
  { min: 1500, name: "Зерттеуші", next: 2200 },
  { min: 2200, name: "Ғалым", next: 3000 },
  { min: 3000, name: "Академик", next: 9999 },
];
const ACHIEVEMENTS = [
  {
    id: "first",
    icon: "🚀",
    name: "Алғашқы қадам",
    desc: "1 сұрақ",
    req: (s) => s.total >= 1,
  },
  {
    id: "ten",
    icon: "🔟",
    name: "10 сұрақ",
    desc: "10 сұрақ",
    req: (s) => s.total >= 10,
  },
  {
    id: "fifty",
    icon: "⚡",
    name: "50 сұрақ",
    desc: "50 сұрақ",
    req: (s) => s.total >= 50,
  },
  {
    id: "streak3",
    icon: "🔥",
    name: "3 күн",
    desc: "3 күн streak",
    req: (s) => calcStreak() >= 3,
  },
  {
    id: "quiz10",
    icon: "🧠",
    name: "Тест шебері",
    desc: "10 тест",
    req: (s) => (s.quizzes || 0) >= 10,
  },
  {
    id: "flash",
    icon: "🃏",
    name: "Карточка",
    desc: "20 карточка",
    req: (s) => (s.cards || 0) >= 20,
  },
  {
    id: "plan",
    icon: "📅",
    name: "Жоспарлаушы",
    desc: "3 жоспар",
    req: (s) => (s.plans || 0) >= 3,
  },
];
function emptyStats() {
  return {
    total: 0,
    today: 0,
    lastDate: "",
    streak: 0,
    quizzes: 0,
    cards: 0,
    plans: 0,
  };
}
function storageKey(base, userId = getCurrentUser()?.id) {
  return `${base}:${userId || "guest"}`;
}
function getStats() {
  const empty = emptyStats();
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(STAT_KEY)));
    const result = stored ? { ...empty, ...stored } : empty;
    if (result.lastDate !== localDateKey()) result.today = 0;
    return result;
  } catch {
    return empty;
  }
}
function saveStats(s) {
  localStorage.setItem(storageKey(STAT_KEY), JSON.stringify(s));
}
function getXP() {
  const value = Number.parseInt(
    localStorage.getItem(storageKey(XP_KEY)) || "0",
    10,
  );
  return Number.isFinite(value) ? value : 0;
}
export function addXP(n) {
  if (!getCurrentUser()) return;
  localStorage.setItem(storageKey(XP_KEY), String(getXP() + n));
  recordEvent({ xp: n });
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear(),
    m = String(date.getMonth() + 1).padStart(2, "0"),
    d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function dayIndex(value) {
  if (!value) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(
    new Date(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
    ).getTime() / 86400000,
  );
}
const pendingKey = (uid) => "sh-progress-events:" + uid;
let syncing = null;
onSessionReset(() => {
  clearTimeout(progressSyncTimer);
  syncing = null;
});
function recordEvent(delta) {
  const scope = captureSession();
  if (!scope.userId) return;
  const events = readJSON(pendingKey(scope.userId), []);
  for (let xp = delta.xp || 0; xp > 0; xp -= 20)
    events.push({
      id: crypto.randomUUID(),
      date: localDateKey(),
      xp: Math.min(20, xp),
    });
  if (delta.type)
    events.push({
      id: crypto.randomUUID(),
      date: localDateKey(),
      type: delta.type,
    });
  localStorage.setItem(pendingKey(scope.userId), JSON.stringify(events));
  queueProgressSync();
}
function queueProgressSync() {
  clearTimeout(progressSyncTimer);
  progressSyncTimer = setTimeout(() => syncProgress().catch(() => {}), 500);
}
async function syncProgress() {
  const scope = captureSession(),
    db = getSupabaseClient();
  if (!scope.userId || !db || syncing === scope.userId) return;
  syncing = scope.userId;
  try {
    // Snapshot is only used as a migration floor; subsequent changes are idempotent deltas.
    const allPending = readJSON(pendingKey(scope.userId), []),
      events = allPending.slice(0, 250),
      ids = new Set(events.map((e) => e.id));
    const oldStats = getStats();
    for (const e of allPending) {
      const key = { q: "total", quiz: "quizzes", card: "cards", plan: "plans" }[
        e.type
      ];
      if (key) oldStats[key] = Math.max(0, (oldStats[key] || 0) - 1);
    }
    const floor = readJSON("sh-progress-baseline:" + scope.userId, null) || {
      stats: oldStats,
      xp: Math.max(
        0,
        getXP() - allPending.reduce((sum, e) => sum + (e.xp || 0), 0),
      ),
    };
    if (!localStorage.getItem("sh-progress-baseline:" + scope.userId))
      localStorage.setItem(
        "sh-progress-baseline:" + scope.userId,
        JSON.stringify(floor),
      );
    const { data, error } = await withDeadline(
      (signal) =>
        db
          .rpc("merge_progress_events", { p_events: events, p_baseline: floor })
          .abortSignal(signal),
      { timeoutMs: 8000 },
    );
    if (error) throw error;
    scope.assert();
    const remaining = readJSON(pendingKey(scope.userId), []).filter(
      (e) => !ids.has(e.id),
    );
    localStorage.setItem(pendingKey(scope.userId), JSON.stringify(remaining));
    if (data) {
      let stats = { ...emptyStats(), ...data.stats },
        xp = Number(data.xp) || 0;
      for (const event of remaining) {
        xp += event.xp || 0;
        const key = {
          q: "total",
          quiz: "quizzes",
          card: "cards",
          plan: "plans",
        }[event.type];
        if (key) stats[key] = (stats[key] || 0) + 1;
        if (event.type === "q" && event.date === localDateKey()) {
          stats.today =
            (stats.lastDate === event.date ? stats.today || 0 : 0) + 1;
          stats.lastDate = event.date;
        }
      }
      localStorage.setItem(storageKey(XP_KEY, scope.userId), String(xp));
      localStorage.setItem(
        storageKey(STAT_KEY, scope.userId),
        JSON.stringify(stats),
      );
    }
    if (remaining.length) queueProgressSync();
    renderStats();
  } finally {
    if (syncing === scope.userId) syncing = null;
  }
}
export async function loadProgress() {
  try {
    await syncProgress();
  } catch (error) {
    console.warn("Progress pending:", error.code || error.name);
  }
}
if (typeof window !== "undefined")
  window.addEventListener("online", () => loadProgress());
export function addStat(type, val) {
  const s = getStats();
  const today = localDateKey();
  if (s.lastDate !== today && type === "q") {
    const previousDay = dayIndex(s.lastDate),
      currentDay = dayIndex(today);
    s.streak =
      previousDay !== null && currentDay - previousDay === 1
        ? Math.max(1, Number(s.streak) || 1) + 1
        : 1;
    s.today = 0;
    s.lastDate = today;
  }
  if (type === "q") {
    s.total++;
    s.today++;
  } else if (type === "quiz") s.quizzes = (s.quizzes || 0) + 1;
  else if (type === "card") s.cards = (s.cards || 0) + 1;
  else if (type === "plan") s.plans = (s.plans || 0) + 1;
  saveStats(s);
  recordEvent({ type });
}
export function renderStats() {
  const s = getStats();
  document.getElementById("stTotal").textContent = s.total;
  document.getElementById("stToday").textContent = s.today;
  document.getElementById("rStreak").textContent = calcStreak();
  const xp = getXP();
  let lvlIdx = 0;
  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= XP_LEVELS[i].min) {
      lvlIdx = i;
      break;
    }
  }
  const lvl = XP_LEVELS[lvlIdx];
  const nextLvl = XP_LEVELS[Math.min(lvlIdx + 1, XP_LEVELS.length - 1)];
  const maxLevel = lvlIdx === XP_LEVELS.length - 1;
  const pct = maxLevel
    ? 100
    : Math.min(100, Math.round(((xp - lvl.min) / (lvl.next - lvl.min)) * 100));
  document.getElementById("xpLevel").textContent = `Деңгей ${lvlIdx + 1}`;
  document.getElementById("xpTitle").textContent = lvl.name;
  document.getElementById("xpCurrent").textContent = xp + " XP";
  document.getElementById("xpNext").textContent = maxLevel
    ? "Максималды деңгей"
    : lvl.next + " XP";
  document.getElementById("xpBarFill").style.width = pct + "%";
  document.getElementById("xpInfo").textContent = maxLevel
    ? "Максималды деңгей"
    : `${Math.max(0, lvl.next - xp)} XP жинасаң — "${nextLvl.name}" деңгейіне өтесің`;
  const badges = document.getElementById("xpBadges");
  badges.innerHTML = "";
  if (lvlIdx >= 3)
    badges.innerHTML = `<span class="badge badge-gold">${lvl.name}</span>`;
  else if (lvlIdx >= 1)
    badges.innerHTML = `<span class="badge badge-silver">${lvl.name}</span>`;
  else badges.innerHTML = `<span class="badge badge-bronze">${lvl.name}</span>`;
  const ag = document.getElementById("achievGrid");
  ag.innerHTML = "";
  ACHIEVEMENTS.forEach((a) => {
    const unlocked = a.req(s);
    ag.innerHTML += `<div class="achievement${unlocked ? " unlocked" : ""}">
      <span class="ach-icon">${a.icon}</span>
      <span class="ach-name">${a.name}</span>
      <span class="ach-desc">${a.desc}</span>
      ${!unlocked ? `<svg class="lock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` : ""}
    </div>`;
  });
}
function calcStreak() {
  const s = getStats();
  if (!s.lastDate) return 0;
  const last = dayIndex(s.lastDate),
    today = dayIndex(localDateKey());
  return last !== null && today - last <= 1 ? Number(s.streak || 1) : 0;
}
