import { initBackground } from './ui/background.js';
import { initializeSupabase } from './services/supabase.js';
import { requestAIStream } from './services/ai.js';
import { addXP, addStat, loadProgress, renderStats } from './modules/progress.js';
import { esc, fmtTxt } from './utils/text.js';
import { runTool } from './modules/tools.js';
import { initPlanner, loadSavedPlan, runPlanner } from './modules/planner.js';
import { createFlashcardsFromText, fcResult, flipCard, genFlashcards, initFlashcards, loadSavedFlashcards, nextCard, setFCSubj } from './modules/flashcards.js';
import { createQuizFromText, genQuiz, initQuiz, loadSavedQuiz, nextQuizQuestion, resetQuiz } from './modules/quiz.js';

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
  if (page === 'quiz') initQuiz();
  if (page === 'planner') initPlanner();
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

/* ═══ CHAT ═══ */
let msgs = [], chatId = null, hist = [];
let pendingAttachments = [];
let chatRequestActive = false;
const retryRequests = new Map();
const answerTexts = new Map();
let webEnabled = localStorage.getItem('sh-web') !== 'off';
let deepEnabled = localStorage.getItem('sh-deep') === 'on';
const msa = document.getElementById('msa');
const cta = document.getElementById('cta');
const sndbtn = document.getElementById('sndbtn');
const webbtn = document.getElementById('webbtn');
const deepbtn = document.getElementById('deepbtn');
const modelBadgeText = document.getElementById('modelBadgeText');
const chatFileInput = document.getElementById('chatFileInput');
const attachmentList = document.getElementById('attachmentList');
const attachmentError = document.getElementById('attachmentError');
const attachBtn = document.getElementById('attachBtn');

function setWebEnabled(enabled) {
  webEnabled = enabled;
  localStorage.setItem('sh-web', enabled ? 'on' : 'off');
  webbtn.classList.toggle('on', enabled);
  webbtn.setAttribute('aria-pressed', String(enabled));
  webbtn.title = enabled
    ? 'Wikipedia дереккөздері қосулы'
    : 'Wikipedia дереккөздері өшірулі';
}

function setDeepEnabled(enabled) {
  deepEnabled = enabled;
  localStorage.setItem('sh-deep', enabled ? 'on' : 'off');
  deepbtn.classList.toggle('on', enabled);
  deepbtn.setAttribute('aria-pressed', String(enabled));
  deepbtn.title = enabled
    ? 'Терең жауап қосулы — жауап ұзағырақ жасалуы мүмкін'
    : 'Жылдам жауап режимі қосулы';
  modelBadgeText.textContent = enabled ? 'Терең AI' : 'Жылдам AI';
}

setWebEnabled(webEnabled);
setDeepEnabled(deepEnabled);

sndbtn.onclick = sendMsg;
cta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
cta.addEventListener('input', () => { cta.style.height = 'auto'; cta.style.height = Math.min(cta.scrollHeight, 140) + 'px'; });
document.getElementById('newbtn').onclick = newChat;
document.getElementById('mobbtn').onclick = () => document.getElementById('csb').classList.toggle('open');
chatFileInput.addEventListener('change', async () => {
  attachBtn.disabled = true;
  attachmentError.textContent = 'Файл өңделуде...';
  attachmentError.dataset.state = 'loading';
  try {
    await addAttachments([...chatFileInput.files]);
    attachmentError.textContent = '';
  } catch (error) {
    attachmentError.textContent = error.message;
    attachmentError.dataset.state = 'error';
  } finally {
    attachBtn.disabled = false;
    chatFileInput.value = '';
  }
});

function newChat() {
  if (chatRequestActive) return;
  chatId = null; msgs = [];
  answerTexts.clear(); retryRequests.clear();
  pendingAttachments = [];
  renderPendingAttachments();
  attachmentError.textContent = '';
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

const readAsDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Файлды оқу мүмкін болмады'));
  reader.readAsDataURL(file);
});

const readAsText = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Файлды оқу мүмкін болмады'));
  reader.readAsText(file);
});

async function prepareImage(file, sourceType) {
  if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name}: фото 8 МБ-тан үлкен`);
  if (file.size <= 900 * 1024) {
    const rawDataUrl = String(await readAsDataURL(file));
    const dataUrl = rawDataUrl.replace(/^data:[^;]*;base64,/, `data:${sourceType};base64,`);
    return { dataUrl, type: sourceType, size: file.size };
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`${file.name}: сурет ашылмады`));
      element.src = objectUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!blob) throw new Error(`${file.name}: суретті өңдеу мүмкін болмады`);
    return { dataUrl: await readAsDataURL(blob), type: 'image/webp', size: blob.size };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareAttachment(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const inferredImageType = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp' }[extension];
  const imageType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ? file.type
    : inferredImageType;
  if (imageType) {
    return { id: crypto.randomUUID(), name: file.name, kind: 'image', ...(await prepareImage(file, imageType)) };
  }
  if (file.type === 'application/pdf' || extension === 'pdf') {
    if (file.size > 2.4 * 1024 * 1024) throw new Error(`${file.name}: PDF 2.4 МБ-тан үлкен`);
    const rawDataUrl = String(await readAsDataURL(file));
    const dataUrl = rawDataUrl.replace(/^data:[^;]*;base64,/, 'data:application/pdf;base64,');
    return { id: crypto.randomUUID(), name: file.name, kind: 'pdf', type: 'application/pdf', size: file.size, dataUrl };
  }
  if (['txt', 'md', 'csv'].includes(extension) || ['text/plain', 'text/markdown', 'text/csv'].includes(file.type)) {
    if (file.size > 250 * 1024) throw new Error(`${file.name}: мәтіндік файл 250 КБ-тан үлкен`);
    return { id: crypto.randomUUID(), name: file.name, kind: 'text', type: file.type || 'text/plain', size: file.size, content: (await readAsText(file)).slice(0, 20000) };
  }
  throw new Error(`${file.name}: бұл файл түрі қолдау таппайды`);
}

async function addAttachments(files) {
  const slots = 3 - pendingAttachments.length;
  if (slots <= 0) throw new Error('Бір хабарламаға ең көбі 3 файл қосуға болады');
  for (const file of files.slice(0, slots)) {
    const attachment = await prepareAttachment(file);
    const nextDataSize = [...pendingAttachments, attachment]
      .reduce((total, item) => total + (item.dataUrl?.length || 0), 0);
    if (nextDataSize > 3_200_000) throw new Error('Файлдардың жалпы көлемі тым үлкен');
    pendingAttachments.push(attachment);
    renderPendingAttachments();
  }
  renderPendingAttachments();
}

function renderPendingAttachments() {
  attachmentList.replaceChildren();
  pendingAttachments.forEach((attachment) => {
    const chip = document.createElement('div'); chip.className = 'attachment-preview';
    const icon = attachment.kind === 'image' ? 'Фото' : attachment.kind === 'pdf' ? 'PDF' : 'TXT';
    chip.innerHTML = `<span class="attachment-kind">${icon}</span><span>${esc(attachment.name)}</span><button type="button" data-action="remove-attachment" data-attachment-id="${attachment.id}" aria-label="${esc(attachment.name)} файлын алып тастау">×</button>`;
    attachmentList.appendChild(chip);
  });
}

function removeAttachment(id) {
  pendingAttachments = pendingAttachments.filter((attachment) => attachment.id !== id);
  renderPendingAttachments();
  attachmentError.textContent = '';
}

function attachmentMetadata(attachments) {
  return attachments.map(({ name, type, kind }) => ({ name, type, kind }));
}

async function sendMsg() {
  const typedText = cta.value.trim();
  if ((!typedText && !pendingAttachments.length) || chatRequestActive) return;
  const attachments = pendingAttachments;
  const text = typedText || 'Осы файлдарды талдап, түсіндір.';
  const metadata = attachmentMetadata(attachments);
  document.getElementById('wlc')?.remove();
  addBubble(text, true, [], '', { attachments: metadata });
  msgs.push({ role: 'user', content: text, ...(metadata.length ? { attachments: metadata } : {}) });
  cta.value = ''; cta.style.height = 'auto';
  pendingAttachments = []; renderPendingAttachments();
  const request = {
    text,
    attachments,
    messages: msgs.map(({ role, content }) => ({ role, content })),
    title: msgs[0]?.content || text,
    web: webEnabled,
    deep: deepEnabled
  };
  await runAssistantRequest(request);
}

async function runAssistantRequest(request, retryKey = crypto.randomUUID()) {
  chatRequestActive = true; sndbtn.disabled = true;
  const bubble = addBubble('', false, [], '', { streaming: true });
  bubble.content.innerHTML = '<span class="streaming-label">AI жауап дайындауда...</span>';
  let latestText = '';
  let streamMeta = {};
  let paintScheduled = false;
  try {
    const response = await requestAIStream({
      messages: request.messages,
      attachments: request.attachments,
      web: request.web,
      deep: request.deep
    }, {
      onMeta: (meta) => { streamMeta = meta; },
      onDelta: (_delta, fullText) => {
        latestText = fullText;
        if (paintScheduled) return;
        paintScheduled = true;
        requestAnimationFrame(() => {
          bubble.content.innerHTML = fmtTxt(latestText);
          answerTexts.set(bubble.content.id, latestText);
          msa.scrollTop = msa.scrollHeight;
          paintScheduled = false;
        });
      }
    }, { onAuthRequired: () => showAuth('login') });
    const reply = response.text || latestText;
    const sources = Array.isArray(response.sources) ? response.sources : (streamMeta.sources || []);
    const webStatus = response.webStatus || streamMeta.webStatus || '';
    bubble.content.innerHTML = fmtTxt(reply);
    answerTexts.set(bubble.content.id, reply);
    bubble.element.classList.remove('streaming');
    bubble.extras.innerHTML = assistantExtras(sources, webStatus);
    msgs.push({
      role: 'assistant', content: reply,
      ...(sources.length ? { sources } : {}),
      ...(webStatus ? { webStatus } : {})
    });
    retryRequests.delete(retryKey);
    addStat('q'); addXP(10); renderStats();
    saveChat(request.title);
  } catch (error) {
    bubble.element.remove();
    retryRequests.set(retryKey, request);
    addBubble(error.message || 'AI сервисі уақытша қолжетімсіз.', false, [], '', { error: true, retryKey });
  } finally {
    chatRequestActive = false; sndbtn.disabled = false;
  }
}

function assistantExtras(sources = [], webStatus = '') {
  const sourceLinks = sources
    .filter((source) => /^https:\/\/[a-z-]+\.wikipedia\.org\//i.test(source?.url || ''))
    .slice(0, 4)
    .map((source, index) => `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${index + 1}</span>${esc(source.title || 'Wikipedia')}</a>`)
    .join('');
  const webStatusText = {
    no_results: 'Wikipedia: сәйкес дерек табылмады',
    unavailable: 'Wikipedia уақытша қолжетімсіз'
  }[webStatus] || '';
  return `${sourceLinks ? `<div class="source-links"><small>Wikipedia дереккөздері</small>${sourceLinks}</div>` : ''}${webStatusText ? `<div class="source-status">${esc(webStatusText)}</div>` : ''}`;
}

function addBubble(text, isUser, sources = [], webStatus = '', options = {}) {
  const d = document.createElement('div'); d.className = 'msg' + (isUser ? ' user' : '');
  if (options.streaming) d.classList.add('streaming');
  if (options.error) d.classList.add('message-error');
  const av = `<div class="mav ${isUser ? 'uav' : 'aiav'}">${isUser
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--tx2)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 7V14Q20 20 12 23Q4 20 4 14V7Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="2.5" fill="white" fill-opacity=".95"/><path d="M12 4V10" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`
  }</div>`;
  const attachments = Array.isArray(options.attachments) ? options.attachments : [];
  const attachmentHtml = attachments.length
    ? `<div class="message-attachments">${attachments.map((attachment) => `<span><b>${attachment.kind === 'image' ? 'Фото' : attachment.kind === 'pdf' ? 'PDF' : 'TXT'}</b>${esc(attachment.name)}</span>`).join('')}</div>`
    : '';
  if (isUser) {
    const uid = 'u' + crypto.randomUUID();
    d.innerHTML = av + `<div class="msg-wrap"><div class="mb ub" id="${uid}">${esc(text)}</div>
      ${attachmentHtml}
      <div class="message-actions" style="justify-content:flex-end">
        <button class="act-btn" title="Көшіру" aria-label="Хабарламаны көшіру" data-action="copy-message" data-message-id="${uid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      </div></div>`;
  } else {
    const rid = 'r' + crypto.randomUUID();
    answerTexts.set(rid, text);
    const actions = options.error
      ? `<button class="retry-btn" data-action="retry-message" data-retry-key="${esc(options.retryKey || '')}">Қайта жіберу</button>`
      : `<button class="act-btn" title="Көшіру" aria-label="AI жауабын көшіру" data-action="copy-message" data-message-id="${rid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="study-action" data-action="answer-to-flashcards" data-message-id="${rid}">Карточкалар</button>
        <button class="study-action" data-action="answer-to-quiz" data-message-id="${rid}">Тест</button>`;
    d.innerHTML = av + `<div class="msg-wrap"><div class="mb aib" id="${rid}">${options.error ? esc(text) : fmtTxt(text)}</div>
      <div class="assistant-extras">${assistantExtras(sources, webStatus)}</div>
      <div class="message-actions">
        ${actions}
      </div></div>`;
  }
  msa.appendChild(d); msa.scrollTop = msa.scrollHeight;
  return {
    element: d,
    content: d.querySelector('.mb'),
    extras: d.querySelector('.assistant-extras')
  };
}

async function retryMessage(control) {
  const key = control.dataset.retryKey;
  const request = retryRequests.get(key);
  if (!request || chatRequestActive) return;
  control.closest('.msg')?.remove();
  await runAssistantRequest(request, key);
}

async function makeStudyMaterial(kind, messageId) {
  const text = answerTexts.get(messageId) || document.getElementById(messageId)?.innerText || '';
  if (!text || chatRequestActive) return;
  if (kind === 'flashcards') {
    go('flashcard');
    await createFlashcardsFromText(text);
  } else {
    go('quiz');
    await createQuizFromText(text);
  }
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
    d.onclick = () => {
      if (chatRequestActive) return;
      chatId=ch.id; msgs=ch.messages||[]; answerTexts.clear(); retryRequests.clear();
      pendingAttachments=[]; renderPendingAttachments(); msa.innerHTML='';
      msgs.forEach(m => addBubble(m.content,m.role==='user',m.sources,m.webStatus,{attachments:m.attachments}));
      hlHist(); document.getElementById('csb').classList.remove('open');
    };
    l.appendChild(d);
  });
}
function hlHist() { document.querySelectorAll('.hi').forEach((el,i) => el.classList.toggle('on',hist[i]?.id===chatId)); }

/* ═══ BURGER ═══ */
document.getElementById('burger').onclick = () => document.getElementById('nlinks').classList.toggle('open');
document.addEventListener('smart-helper:auth-required', () => showAuth('login'));
document.addEventListener('change', (event) => {
  if (event.target.id === 'fcSavedSelect') loadSavedFlashcards();
  if (event.target.id === 'quizSavedSelect') loadSavedQuiz();
  if (event.target.id === 'planSavedSelect') loadSavedPlan();
});

document.addEventListener('click', event => {
  const control = event.target.closest('[data-go],[data-action]');
  if (!control) return;

  if (control.dataset.go) {
    go(control.dataset.go, control.dataset.authTab);
    return;
  }

  const actions = {
    'answer-to-flashcards': () => makeStudyMaterial('flashcards', control.dataset.messageId),
    'answer-to-quiz': () => makeStudyMaterial('quiz', control.dataset.messageId),
    'auth-tab': () => atab(control.dataset.tab),
    'choose-attachments': () => chatFileInput.click(),
    'copy-message': () => copyMsg(control, control.dataset.messageId),
    'flashcard-result': () => fcResult(control.dataset.result),
    'flip-card': () => flipCard(),
    'generate-flashcards': () => genFlashcards(),
    'generate-quiz': () => genQuiz(),
    'google-login': () => doGoogle(),
    'login': () => doLogin(),
    'logo': () => currentUser ? go('chat') : showAuth(),
    'next-card': () => nextCard(),
    'next-quiz-question': () => nextQuizQuestion(),
    'quick-prompt': () => qpu(control),
    'register': () => doReg(),
    'remove-attachment': () => removeAttachment(control.dataset.attachmentId),
    'reset-quiz': () => resetQuiz(),
    'retry-message': () => retryMessage(control),
    'run-planner': () => runPlanner(),
    'run-tool': () => runTool(control.dataset.tool, control),
    'set-flashcard-subject': () => setFCSubj(control),
    'toggle-deep': () => setDeepEnabled(!deepEnabled),
    'toggle-web': () => setWebEnabled(!webEnabled)
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
