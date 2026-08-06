import { initBackground } from './ui/background.js';
import { initializeSupabase } from './services/supabase.js';
import { requestAI } from './services/ai.js';
import { addXP, addStat, loadProgress, renderStats } from './modules/progress.js';
import { esc, fmtTxt } from './utils/text.js';
import { runTool } from './modules/tools.js';
import { runPlanner } from './modules/planner.js';
import { fcResult, flipCard, genFlashcards, initFlashcards, nextCard, setFCSubj } from './modules/flashcards.js';
import { genQuiz, resetQuiz } from './modules/quiz.js';

initBackground();

/* ═══ CONFIG ═══ */
let supabaseClient = null;
let currentUser = null;

async function initSupabase() {
  supabaseClient = await initializeSupabase(applyAuthSession);
}

/* ═══ THEME ═══ */
const tbtn = document.getElementById('tbtn');
const setTheme = t => {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('sh-t', t);
  if (window._reinitBg) window._reinitBg();
  tbtn.innerHTML = t === 'dark'
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
};
setTheme(localStorage.getItem('sh-t') || 'dark');
tbtn.onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

/* ═══ ROUTER ═══ */
function go(page, sub) {
  if (page === 'auth') { showAuth(sub); return; }
  if (!currentUser) { showAuth(); return; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.chatwrap').forEach(p => p.classList.remove('on'));
  if (page === 'chat') {
    document.getElementById('pg-chat').classList.add('on');
    document.body.style.overflow = 'hidden';
  } else {
    document.getElementById('pg-' + page).classList.add('on');
    document.body.style.overflow = '';
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nb[data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === page));
  if (page === 'stats') renderStats();
  if (page === 'flashcard') initFlashcards();
  document.querySelector('.nav').classList.remove('hidden');
}

function showAuth(sub) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.chatwrap').forEach(p => p.classList.remove('on'));
  document.getElementById('pg-auth').classList.add('on');
  document.body.style.overflow = '';
  document.querySelector('.nav').classList.add('hidden');
  document.querySelectorAll('.nb[data-p]').forEach(b => b.classList.remove('on'));
  window.scrollTo(0, 0);
  if (sub) atab(sub);
}

/* ═══ AUTH STATE ═══ */
let _authReady = false;
let _authUserId = null;
function applyAuthSession(session) {
  const user = session?.user || null;
  const nextUserId = user?.id || null;
  const changed = nextUserId !== _authUserId;
  currentUser = user;
  document.getElementById('anav').style.display = user ? 'none' : 'flex';
  document.getElementById('unav').style.display = user ? 'flex' : 'none';
  if (user) {
    document.getElementById('ubadge').textContent = user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';
    if (changed || !_authReady) setTimeout(() => { loadHistory(); loadProgress(); }, 0);
    if (!_authReady) go('chat');
  } else {
    clearHistUI();
    showAuth();
  }
  _authUserId = nextUserId;
  _authReady = true;
}
document.getElementById('loutbtn').onclick = async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
  showAuth();
};

/* ═══ AUTH FORMS ═══ */
function atab(tab) {
  const isL = tab === 'login';
  const tL = document.getElementById('tabL');
  const tR = document.getElementById('tabR');
  if (tL) {
    tL.style.background    = isL ? 'rgba(0,212,255,.1)' : 'transparent';
    tL.style.color         = isL ? 'var(--ac)' : 'var(--tx2)';
    tL.style.fontWeight    = isL ? '700' : '500';
    tR.style.background    = !isL ? 'rgba(0,212,255,.1)' : 'transparent';
    tR.style.color         = !isL ? 'var(--ac)' : 'var(--tx2)';
    tR.style.fontWeight    = !isL ? '700' : '500';
  }
  document.getElementById('fL').style.display = isL ? 'block' : 'none';
  document.getElementById('fR').style.display = isL ? 'none' : 'block';
}
async function doLogin() {
  const e = document.getElementById('lE').value.trim(), p = document.getElementById('lP').value;
  const err = document.getElementById('lErr'); err.textContent = '';
  if (!e || !p) { err.textContent = 'Толтырыңыз'; return; }
  setbl('lBtn', true, 'Кіру');
  try {
    if (!supabaseClient) throw new Error('Supabase әлі дайын емес');
    const { error } = await supabaseClient.auth.signInWithPassword({ email:e, password:p });
    if (error) throw error;
    go('chat');
  }
  catch (ex) { err.textContent = autherr(ex); }
  setbl('lBtn', false, 'Кіру');
}
async function doReg() {
  const n = document.getElementById('rN').value.trim(), e = document.getElementById('rE').value.trim(), p = document.getElementById('rP').value;
  const err = document.getElementById('rErr'); err.textContent = '';
  if (!n || !e || !p) { err.textContent = 'Барлық өрісті толтырыңыз'; return; }
  if (p.length < 6) { err.textContent = 'Кемінде 6 символ'; return; }
  setbl('rBtn', true, 'Тіркелу');
  try {
    if (!supabaseClient) throw new Error('Supabase әлі дайын емес');
    const { data, error } = await supabaseClient.auth.signUp({
      email:e,
      password:p,
      options:{ data:{ display_name:n, full_name:n }, emailRedirectTo:window.location.origin }
    });
    if (error) throw error;
    if (data.session) go('chat');
    else err.textContent = 'Email-ге келген растау сілтемесін ашыңыз';
  }
  catch (ex) { err.textContent = autherr(ex); }
  setbl('rBtn', false, 'Тіркелу');
}
async function doGoogle() {
  try {
    if (!supabaseClient) throw new Error('Supabase әлі дайын емес');
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider:'google',
      options:{ redirectTo:window.location.origin }
    });
    if (error) throw error;
  }
  catch (ex) { const el = document.getElementById('lErr'); if (el) el.textContent = autherr(ex); }
}
const autherr = error => ({
  invalid_credentials:'Email немесе құпия сөз қате',
  email_not_confirmed:'Алдымен email адресіңізді растаңыз',
  user_already_exists:'Email бұрын тіркелген',
  weak_password:'Құпия сөз тым қарапайым',
  validation_failed:'Email форматы дұрыс емес',
  over_email_send_rate_limit:'Хаттар тым жиі жіберілді. Кейінірек көріңіз.'
})[error?.code] || error?.message || 'Қате орын алды';
const setbl = (id, l, t) => { const b = document.getElementById(id); b.disabled = l; b.textContent = l ? 'Күте тұрыңыз...' : t; };

function callAI(task, payload = {}) {
  return requestAI(task, payload, { onAuthRequired: () => showAuth('login') });
}

/* ═══ CHAT ═══ */
let msgs = [], chatId = null, hist = [], curMode = 'general';
const msa = document.getElementById('msa');
const cta = document.getElementById('cta');
const sndbtn = document.getElementById('sndbtn');

function setMode(btn) {
  document.querySelectorAll('.modesel').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  curMode = btn.dataset.mode;
}

sndbtn.onclick = sendMsg;
cta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
cta.addEventListener('input', () => { cta.style.height = 'auto'; cta.style.height = Math.min(cta.scrollHeight, 140) + 'px'; });
document.getElementById('newbtn').onclick = newChat;
document.getElementById('clrbtn').onclick = () => { if (confirm('Чатты тазалайсыз ба?')) newChat(); };
document.getElementById('mobbtn').onclick = () => document.getElementById('csb').classList.toggle('open');

function newChat() {
  chatId = null; msgs = [];
  msa.innerHTML = ''; msa.appendChild(mkWelcome());
  hlHist(); document.getElementById('csb').classList.remove('open');
}

function mkWelcome() {
  const d = document.createElement('div'); d.className = 'welcome'; d.id = 'wlc';
  d.innerHTML = `<div class="wico"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 7V14Q20 20 12 23Q4 20 4 14V7Z" stroke="var(--ac)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3" fill="var(--ac)" fill-opacity=".8"/><path d="M12 4V10" stroke="var(--ac)" stroke-width="1.5" stroke-linecap="round"/></svg></div>
    <h2>Сәлем! Мен Smart Helper</h2>
    <p>Режим таңдап, сұрағыңызды жазыңыз.<br>Оқу, ғылым, математика — бәрі бойынша.</p>
    <div class="qps">
      <button class="qp" data-action="quick-prompt">sin(30°) = неше?</button>
      <button class="qp" data-action="quick-prompt">Эссе жазуға көмектес</button>
      <button class="qp" data-action="quick-prompt">Қазақстан тарихы</button>
      <button class="qp" data-action="quick-prompt">Атом құрылысы</button>
    </div>`;
  return d;
}

function qpu(btn) { cta.value = btn.textContent.trim(); cta.focus(); }

async function sendMsg() {
  const txt = cta.value.trim(); if (!txt || sndbtn.disabled) return;
  document.getElementById('wlc')?.remove();
  addBubble(txt, true); cta.value = ''; cta.style.height = 'auto';
  msgs.push({ role: 'user', content: txt });
  sndbtn.disabled = true;
  const tid = 'td' + Date.now();
  addTyping(tid);
  try {
    const d = await callAI('chat', { mode: curMode, messages: msgs });
    const reply = d.text || 'Жауап алынбады';
    rmEl(tid); addBubble(reply, false);
    msgs.push({ role: 'assistant', content: reply });
    addStat('q', curMode); addXP(10); renderStats();
    if (msgs.length === 2) saveChat(txt); else saveChat(msgs[0].content);
  } catch (error) {
    rmEl(tid);
    addBubble(error.message || 'AI сервисі уақытша қолжетімсіз.', false);
  }
  sndbtn.disabled = false;
}

function addBubble(text, isUser) {
  const d = document.createElement('div'); d.className = 'msg' + (isUser ? ' user' : '');
  const av = `<div class="mav ${isUser ? 'uav' : 'aiav'}">${isUser
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--tx2)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 7V14Q20 20 12 23Q4 20 4 14V7Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="2.5" fill="white" fill-opacity=".95"/><path d="M12 4V10" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`
  }</div>`;
  if (isUser) {
    const uid = 'u' + Date.now();
    d.innerHTML = av + `<div class="msg-wrap"><div class="mb ub" id="${uid}">${esc(text)}</div>
      <div class="rate-row" style="justify-content:flex-end">
        <button class="act-btn" title="Көшіру" data-action="copy-message" data-message-id="${uid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="act-btn" title="Өңдеу" data-action="edit-message" data-message-id="${uid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      </div></div>`;
  } else {
    const rid = 'r' + Date.now();
    d.innerHTML = av + `<div class="msg-wrap"><div class="mb aib" id="${rid}">${fmtTxt(text)}</div>
      <div class="rate-row">
        <button class="act-btn" title="Көшіру" data-action="copy-message" data-message-id="${rid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="act-btn" title="Жақсы" data-action="rate-message" data-rating="good"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button>
        <button class="act-btn" title="Нашар" data-action="rate-message" data-rating="bad"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button>
      </div></div>`;
  }
  msa.appendChild(d); msa.scrollTop = msa.scrollHeight;
}

function addTyping(id) {
  const d = document.createElement('div'); d.className = 'msg'; d.id = id;
  d.innerHTML = `<div class="mav aiav"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 7V14Q20 20 12 23Q4 20 4 14V7Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="2.5" fill="white" fill-opacity=".95"/></svg></div>
    <div class="mb aib typing"><span></span><span></span><span></span></div>`;
  msa.appendChild(d); msa.scrollTop = msa.scrollHeight;
}
function rmEl(id) { document.getElementById(id)?.remove(); }

function rateMsg(btn, type) {
  const row = btn.closest('.rate-row');
  const btns = row.querySelectorAll('.act-btn');
  const previous = row.dataset.rating || '';
  const next = previous === type ? '' : type;
  row.dataset.rating = next;
  btns[1]?.classList.toggle('liked', next === 'good');
  btns[2]?.classList.toggle('disliked', next === 'bad');
  addStat('r', { previous, next });
  renderStats();
}
function copyMsg(btn, id) {
  const el = document.getElementById(id); if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => {
    btn.classList.add('copied');
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
  });
}
function editMsg(btn, id) {
  const el = document.getElementById(id); if (!el) return;
  cta.value = el.innerText; cta.style.height = 'auto';
  cta.style.height = Math.min(cta.scrollHeight, 140) + 'px'; cta.focus();
}

/* ═══ SUPABASE HISTORY ═══ */
async function saveChat(first) {
  if (!currentUser || !supabaseClient) return;
  if (!chatId) chatId = crypto.randomUUID();
  const title = first.length > 40 ? first.slice(0,40)+'…' : first;
  const row={id:chatId,user_id:currentUser.id,title,messages:msgs.slice(-40),updated_at:new Date().toISOString()};
  const { error } = await supabaseClient.from('chats').upsert(row,{onConflict:'id'});
  if (error) { console.warn('Chat save failed',error.code||error.message); return; }
  hist=[{id:row.id,title:row.title,messages:row.messages,updated_at:row.updated_at},...hist.filter(ch=>ch.id!==row.id)].slice(0,60);
  renderHist();
}
async function loadHistory() {
  if (!currentUser || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('chats')
    .select('id,title,messages,updated_at').order('updated_at',{ascending:false}).limit(60);
  if (error) { console.warn('History load failed',error.code||error.message); return; }
  hist=data||[];
  renderHist();
}
function clearHistUI() { hist=[]; renderHist(); }
function renderHist() {
  const l = document.getElementById('hlist'), e = document.getElementById('hempty');
  l.innerHTML = '';
  if (!hist.length) { e && l.appendChild(e); return; }
  hist.forEach(ch => {
    const d = document.createElement('button'); d.className = 'hi'+(ch.id===chatId?' on':'');
    d.innerHTML = `<div class="hi-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><span class="hit">${esc(ch.title||'Сұхбат')}</span>`;
    d.onclick = () => { chatId=ch.id; msgs=ch.messages||[]; msa.innerHTML=''; msgs.forEach(m => addBubble(m.content,m.role==='user')); hlHist(); document.getElementById('csb').classList.remove('open'); };
    l.appendChild(d);
  });
}
function hlHist() { document.querySelectorAll('.hi').forEach((el,i) => el.classList.toggle('on',hist[i]?.id===chatId)); }

/* ═══ BURGER ═══ */
document.getElementById('burger').onclick = () => document.getElementById('nlinks').classList.toggle('open');
document.addEventListener('smart-helper:auth-required', () => showAuth('login'));

document.addEventListener('click', event => {
  const control = event.target.closest('[data-go],[data-action]');
  if (!control) return;

  if (control.dataset.go) {
    go(control.dataset.go, control.dataset.authTab);
    return;
  }

  const actions = {
    'auth-tab': () => atab(control.dataset.tab),
    'copy-message': () => copyMsg(control, control.dataset.messageId),
    'edit-message': () => editMsg(control, control.dataset.messageId),
    'flashcard-result': () => fcResult(control.dataset.result),
    'flip-card': () => flipCard(),
    'generate-flashcards': () => genFlashcards(),
    'generate-quiz': () => genQuiz(),
    'google-login': () => doGoogle(),
    'login': () => doLogin(),
    'logo': () => currentUser ? go('chat') : showAuth(),
    'next-card': () => nextCard(),
    'quick-prompt': () => qpu(control),
    'rate-message': () => rateMsg(control, control.dataset.rating),
    'register': () => doReg(),
    'reset-quiz': () => resetQuiz(),
    'run-planner': () => runPlanner(),
    'run-tool': () => runTool(control.dataset.tool, control),
    'set-flashcard-subject': () => setFCSubj(control),
    'set-mode': () => setMode(control)
  };
  actions[control.dataset.action]?.();
});

/* ═══ INIT ═══ */
initFlashcards();
initSupabase().catch(error => {
  console.error('Supabase init failed:',error?.message);
  showAuth('login');
  const el=document.getElementById('lErr');
  if(el) el.textContent='Supabase баптауы аяқталмаған';
});
