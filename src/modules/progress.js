import { getCurrentUser, getSupabaseClient } from '../services/supabase.js';

const STAT_KEY = 'sh-stats', XP_KEY = 'sh-xp';
let progressSyncTimer = null;
const XP_LEVELS = [
  { min:0,    name:'Жаңадан бастаушы', next:100   },
  { min:100,  name:'Оқушы',            next:300   },
  { min:300,  name:'Білгір',           next:600   },
  { min:600,  name:'Данышпан',         next:1000  },
  { min:1000, name:'Шебер',            next:1500  },
  { min:1500, name:'Зерттеуші',        next:2200  },
  { min:2200, name:'Ғалым',            next:3000  },
  { min:3000, name:'Академик',         next:9999  },
];
const ACHIEVEMENTS = [
  { id:'first',   icon:'🚀', name:'Алғашқы қадам', desc:'1 сұрақ',    req:s => s.total >= 1   },
  { id:'ten',     icon:'🔟', name:'10 сұрақ',      desc:'10 сұрақ',   req:s => s.total >= 10  },
  { id:'fifty',   icon:'⚡', name:'50 сұрақ',      desc:'50 сұрақ',   req:s => s.total >= 50  },
  { id:'streak3', icon:'🔥', name:'3 күн',          desc:'3 күн streak',req:s => calcStreak() >= 3 },
  { id:'rating',  icon:'⭐', name:'Сапалы',         desc:'10 оң баға', req:s => s.good >= 10   },
  { id:'quiz10',  icon:'🧠', name:'Тест шебері',    desc:'10 тест',    req:s => (s.quizzes||0) >= 10 },
  { id:'flash',   icon:'🃏', name:'Карточка',       desc:'20 карточка',req:s => (s.cards||0) >= 20 },
  { id:'plan',    icon:'📅', name:'Жоспарлаушы',   desc:'3 жоспар',   req:s => (s.plans||0) >= 3 },
];
function getStats() {
  const empty = {total:0,today:0,good:0,bad:0,lastDate:'',streak:0,subjects:{},quizzes:0,cards:0,plans:0};
  try {
    const stored = JSON.parse(localStorage.getItem(STAT_KEY));
    return stored ? {...empty,...stored,subjects:{...empty.subjects,...(stored.subjects||{})}} : empty;
  } catch { return empty; }
}
function saveStats(s) { localStorage.setItem(STAT_KEY, JSON.stringify(s)); queueProgressSync(); }
function getXP() { return parseInt(localStorage.getItem(XP_KEY) || '0'); }
export function addXP(n) { localStorage.setItem(XP_KEY, getXP() + n); queueProgressSync(); }

function localDateKey(date = new Date()) {
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function dayIndex(value) {
  if (!value) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(new Date(parsed.getFullYear(),parsed.getMonth(),parsed.getDate()).getTime()/86400000);
}
function queueProgressSync() {
  clearTimeout(progressSyncTimer);
  progressSyncTimer=setTimeout(async()=>{
    const currentUser = getCurrentUser();
    const supabaseClient = getSupabaseClient();
    if (!currentUser || !supabaseClient) return;
    const { error } = await supabaseClient.from('progress').upsert({
      user_id:currentUser.id,
      stats:getStats(),
      xp:getXP(),
      updated_at:new Date().toISOString()
    },{onConflict:'user_id'});
    if (error) console.warn('Progress sync failed',error.code||error.message);
  },500);
}
export async function loadProgress() {
  const currentUser = getCurrentUser();
  const supabaseClient = getSupabaseClient();
  if (!currentUser || !supabaseClient) return;
  try {
    const { data:cloud, error } = await supabaseClient.from('progress')
      .select('stats,xp').eq('user_id',currentUser.id).maybeSingle();
    if (error) throw error;
    if (cloud?.stats) localStorage.setItem(STAT_KEY,JSON.stringify(cloud.stats));
    if (Number.isFinite(Number(cloud?.xp))) localStorage.setItem(XP_KEY,String(cloud.xp));
    if (!cloud) queueProgressSync();
    renderStats();
  } catch (error) { console.warn('Progress load failed',error?.code||error?.message); }
}
export function addStat(type, val) {
  const s = getStats();
  const today = localDateKey();
  if (s.lastDate !== today && type === 'q') {
    const previousDay=dayIndex(s.lastDate),currentDay=dayIndex(today);
    s.streak=previousDay!==null&&currentDay-previousDay===1?Math.max(1,Number(s.streak)||1)+1:1;
    s.today=0;
    s.lastDate=today;
  }
  if (type === 'q') { s.total++; s.today++; s.subjects[val] = (s.subjects[val]||0) + 1; }
  else if (type === 'r') {
    if (val.previous === 'good') s.good=Math.max(0,s.good-1);
    if (val.previous === 'bad') s.bad=Math.max(0,s.bad-1);
    if (val.next === 'good') s.good++;
    if (val.next === 'bad') s.bad++;
  }
  else if (type === 'quiz') s.quizzes = (s.quizzes||0) + 1;
  else if (type === 'card') s.cards = (s.cards||0) + 1;
  else if (type === 'plan') s.plans = (s.plans||0) + 1;
  saveStats(s);
}
export function renderStats() {
  const s = getStats();
  document.getElementById('stTotal').textContent = s.total;
  document.getElementById('stToday').textContent = s.today;
  document.getElementById('stGood').textContent = s.good;
  document.getElementById('stBad').textContent = s.bad;
  const tot = s.good + s.bad;
  document.getElementById('rPct').textContent = tot ? Math.round(s.good/tot*100)+'%' : '–';
  document.getElementById('rStreak').textContent = calcStreak();
  const xp = getXP();
  let lvlIdx = 0;
  for (let i = XP_LEVELS.length-1; i >= 0; i--) { if (xp >= XP_LEVELS[i].min) { lvlIdx = i; break; } }
  const lvl = XP_LEVELS[lvlIdx];
  const nextLvl = XP_LEVELS[Math.min(lvlIdx+1, XP_LEVELS.length-1)];
  const pct = Math.min(100, Math.round((xp-lvl.min)/(lvl.next-lvl.min)*100));
  document.getElementById('xpLevel').textContent = `Деңгей ${lvlIdx+1}`;
  document.getElementById('xpTitle').textContent = lvl.name;
  document.getElementById('xpCurrent').textContent = xp+' XP';
  document.getElementById('xpNext').textContent = lvl.next+' XP';
  document.getElementById('xpBarFill').style.width = pct+'%';
  document.getElementById('xpInfo').textContent = `${lvl.next-xp} XP жинасаң — "${nextLvl.name}" деңгейіне өтесің`;
  const badges = document.getElementById('xpBadges'); badges.innerHTML = '';
  if (lvlIdx >= 3) badges.innerHTML = `<span class="badge badge-gold">${lvl.name}</span>`;
  else if (lvlIdx >= 1) badges.innerHTML = `<span class="badge badge-silver">${lvl.name}</span>`;
  else badges.innerHTML = `<span class="badge badge-bronze">${lvl.name}</span>`;
  const ag = document.getElementById('achievGrid'); ag.innerHTML = '';
  ACHIEVEMENTS.forEach(a => {
    const unlocked = a.req(s);
    ag.innerHTML += `<div class="achievement${unlocked?' unlocked':''}">
      <span class="ach-icon">${a.icon}</span>
      <span class="ach-name">${a.name}</span>
      <span class="ach-desc">${a.desc}</span>
      ${!unlocked?`<svg class="lock-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`:''}
    </div>`;
  });
  const bc = document.getElementById('barChart'); bc.innerHTML = '';
  const labels = {general:'Жалпы',math:'Математика',history:'Тарих',science:'Ғылым'};
  const max = Math.max(...Object.values(s.subjects), 1);
  Object.entries(labels).forEach(([k,l]) => {
    const v = s.subjects[k]||0, pct2 = Math.round(v/max*100);
    bc.innerHTML += `<div class="bar-row"><span class="bar-label">${l}</span><div class="bar-bg"><div class="bar-fill" style="width:${pct2}%"></div></div><span class="bar-val">${v}</span></div>`;
  });
}
function calcStreak() {
  const s = getStats(); if (!s.lastDate) return 0;
  const last=dayIndex(s.lastDate),today=dayIndex(localDateKey());
  return last!==null&&today-last<=1?Number(s.streak||1):0;
}
