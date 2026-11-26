import { hasAuthCallback, authCallbackError } from "../lib/auth-callback.js";
import {
  authActions,
  configureAuthInitializer,
  authErrorMessage,
} from "./services/auth.js";
import { installAuthControls } from "./ui/auth-controls.js";
import { installMobileControls } from "./ui/mobile-controls.js";
import "./compat.js";
import { paginateChatMessages } from "../lib/chat-pages.js";
import { safeStorage as localStorage } from "../lib/safe-storage.js";
import { captureSession } from "../lib/session-scope.js";
import {
  saveChatRow,
  stageChatRow,
  listChats,
  readChat,
  flushChats,
  deleteChat,
} from "./services/chat-store.js";
import { installEnhancements, clearPrivateUI } from "./ui/enhancements.js";
import { initBackground } from "./ui/background.js";
import { initializeSupabase } from "./services/supabase.js";
import { requestAIStream } from "./services/ai.js";
import {
  addXP,
  addStat,
  loadProgress,
  renderStats,
} from "./modules/progress.js";
import { esc } from "./utils/text.js";
import { renderRichText, hasMath, onMathReady } from "./utils/rich-text.js";

initBackground();

/* ═══ CONFIG ═══ */
let supabaseClient = null;
let currentUser = null;
let authControls = null;
let activeChatController = null,
  authRequested = false;
let intendedPage = location.hash.slice(1);

async function initSupabase() {
  supabaseClient = await initializeSupabase(applyAuthSession);
  document.getElementById("authReconnect")?.setAttribute("hidden", "");
  authControls?.refreshAvailability({ force: true });
}
configureAuthInitializer(initSupabase);

/* ═══ THEME ═══ */
const tbtn = document.getElementById("tbtn");
const setTheme = (t) => {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("sh-t", t);
  if (window._reinitBg) window._reinitBg();
  tbtn.innerHTML =
    t === "dark"
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
};
setTheme(localStorage.getItem("sh-t") || "dark");
tbtn.onclick = () =>
  setTheme(
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark",
  );

/* ═══ ROUTER ═══ */
function go(page, sub) {
  closeMenus();
  if (
    ![
      "auth",
      "about",
      "chat",
      "planner",
      "flashcard",
      "quiz",
      "tools",
      "stats",
    ].includes(page)
  )
    page = "chat";
  moveStudyOptions(page);
  if (location.hash !== "#" + page) history.pushState({}, "", "#" + page);
  if (page === "auth") {
    authRequested = true;
    initSupabase().catch(showConnectionError);
    showAuth(sub);
    return;
  }
  if (page === "about") {
    showAbout();
    return;
  }
  if (!currentUser) {
    intendedPage = page;
    authRequested = true;
    initSupabase().catch(showConnectionError);
    showAuth("login");
    return;
  }
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("on"));
  document
    .querySelectorAll(".chatwrap")
    .forEach((p) => p.classList.remove("on"));
  if (page === "chat") {
    document.getElementById("pg-chat").classList.add("on");
    document.body.style.overflow = "hidden";
  } else {
    document.getElementById("pg-" + page).classList.add("on");
    document.body.style.overflow = "";
    window.scrollTo(0, 0);
  }
  document
    .querySelectorAll(".nb[data-p]")
    .forEach((b) => b.classList.toggle("on", b.dataset.p === page));
  if (page === "stats") renderStats();
  if (page === "flashcard") initFlashcards();
  if (page === "quiz") initQuiz();
  if (page === "planner") initPlanner();
  document.querySelector(".nav").classList.remove("hidden");
}

function showAbout() {
  closeMenus();
  moveStudyOptions(null);
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("on"));
  document
    .querySelectorAll(".chatwrap")
    .forEach((p) => p.classList.remove("on"));
  document.getElementById("pg-about").classList.add("on");
  document.body.style.overflow = "";
  document.querySelector(".nav").classList.remove("hidden");
  document
    .querySelectorAll(".nb[data-p]")
    .forEach((b) => b.classList.remove("on"));
  window.scrollTo(0, 0);
}

function showAuth(sub) {
  moveStudyOptions(null);
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("on"));
  document
    .querySelectorAll(".chatwrap")
    .forEach((p) => p.classList.remove("on"));
  document.getElementById("pg-auth").classList.add("on");
  document.body.style.overflow = "";
  document.querySelector(".nav").classList.add("hidden");
  document
    .querySelectorAll(".nb[data-p]")
    .forEach((b) => b.classList.remove("on"));
  window.scrollTo(0, 0);
  if (sub) atab(sub);
}

/* ═══ AUTH STATE ═══ */
let _authReady = false;
let _authUserId = null;
function applyAuthSession(session, event) {
  const user = session?.user || null;
  const nextUserId = user?.id || null;
  const changed = nextUserId !== _authUserId;
  if (changed) {
    activeChatController?.abort();
    activeChatController = null;
    chatRequestActive = false;
    sndbtn.disabled = false;
    clearHistUI();
    clearPrivateUI();
    attachmentVersion++;
    preparingFiles = false;
    attachBtn.disabled = false;
  }
  currentUser = user;
  document.getElementById("anav").style.display = user ? "none" : "flex";
  document.getElementById("unav").style.display = user ? "flex" : "none";
  if (user) {
    document.getElementById("ubadge").textContent =
      user.user_metadata?.display_name ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "User";
    if (changed || !_authReady)
      setTimeout(() => {
        if (currentUser?.id !== user.id) return;
        loadHistory();
        loadProgress();
        flushChats().catch(() => {});
        import("./modules/library.js")
          .then((m) => m.flushMaterials())
          .catch(() => {});
      }, 0);
    if (!_authReady) go(location.hash.slice(1) || "chat");
  } else {
    clearHistUI();
    if (!_authReady || changed) {
      if (authRequested) showAuth("login");
      else showAbout();
    }
  }
  _authUserId = nextUserId;
  _authReady = true;
  if (event === "PASSWORD_RECOVERY")
    document.dispatchEvent(new CustomEvent("smart-helper:recovery"));
}
document.getElementById("loutbtn").onclick = async () => {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut({ scope: "local" });
  if (error) {
    document.getElementById("lErr").textContent =
      "Шығу орындалмады. Қайталап көріңіз.";
    showAuth("login");
    return;
  }
  applyAuthSession(null);
  showAbout();
};

/* ═══ AUTH FORMS ═══ */
function atab(tab) {
  document.dispatchEvent(
    new CustomEvent("smart-helper:auth-view", { detail: tab }),
  );
}
async function doLogin() {
  const e = document.getElementById("lE").value.trim(),
    p = document.getElementById("lP").value;
  const err = document.getElementById("lErr");
  err.textContent = "";
  if (!e || !p) {
    err.textContent = "Толтырыңыз";
    return;
  }
  setbl("lBtn", true, "Кіру");
  try {
    if (!supabaseClient) await initSupabase();
    await authActions.login({
      email: e,
      password: p,
    });
    go(
      intendedPage && !["auth", "about"].includes(intendedPage)
        ? intendedPage
        : "chat",
    );
    intendedPage = null;
  } catch (ex) {
    err.textContent = autherr(ex);
  }
  setbl("lBtn", false, "Кіру");
}
async function doReg() {
  const scope = captureSession();
  const n = document.getElementById("rN").value.trim(),
    e = document.getElementById("rE").value.trim(),
    p = document.getElementById("rP").value;
  const err = document.getElementById("rErr");
  err.textContent = "";
  if (!n || !e || !p) {
    err.textContent = "Барлық өрісті толтырыңыз";
    return;
  }
  if (p.length < 8) {
    err.textContent = "Кемінде 8 таңба";
    return;
  }
  setbl("rBtn", true, "Тіркелу");
  try {
    if (!supabaseClient) await initSupabase();
    scope.assert();
    const data = await authActions.register({
      email: e,
      password: p,
      options: {
        data: { display_name: n, full_name: n },
      },
    });
    if (data.session) go("chat");
    else {
      scope.assert();
      document.dispatchEvent(
        new CustomEvent("smart-helper:confirmation", { detail: { email: e } }),
      );
    }
  } catch (ex) {
    if (scope.valid()) err.textContent = autherr(ex);
  }
  setbl("rBtn", false, "Тіркелу");
  authControls?.refreshMailButtons();
}
async function doGoogle() {
  const button = document.getElementById("googleBtn");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    if (!supabaseClient) await initSupabase();
    await authActions.google();
  } catch (ex) {
    const el = document.getElementById("lErr");
    if (el) el.textContent = autherr(ex);
  } finally {
    if (button) button.disabled = false;
    await authControls?.refreshAvailability();
  }
}
const autherr = authErrorMessage;
const setbl = (id, l, t) => {
  const b = document.getElementById(id);
  b.disabled = l;
  b.textContent = l ? "Күте тұрыңыз..." : t;
};

/* ═══ CHAT ═══ */
let msgs = [],
  chatId = null,
  hist = [];
let pendingAttachments = [],
  attachmentVersion = 0,
  preparingFiles = false,
  historyVersion = 0,
  chatOpenVersion = 0;
let chatRequestActive = false;
const retryRequests = new Map();
const answerTexts = new Map();
let webEnabled = localStorage.getItem("sh-web") === "on";
let deepEnabled = localStorage.getItem("sh-deep-v2") === "on";
const msa = document.getElementById("msa");
const cta = document.getElementById("cta");
const sndbtn = document.getElementById("sndbtn");
const webbtn = document.getElementById("webbtn");
const deepbtn = document.getElementById("deepbtn");
const modelBadgeText = document.getElementById("modelBadgeText");
const chatFileInput = document.getElementById("chatFileInput");
const attachmentList = document.getElementById("attachmentList");
const attachmentError = document.getElementById("attachmentError");
const attachBtn = document.getElementById("attachBtn");

function setWebEnabled(enabled) {
  webEnabled = enabled;
  localStorage.setItem("sh-web", enabled ? "on" : "off");
  webbtn.classList.toggle("on", enabled);
  webbtn.setAttribute("aria-pressed", String(enabled));
  webbtn.title = enabled
    ? "Интернеттен, Wikipedia және ғылыми дерекқорлардан іздеу қосулы"
    : "Интернет іздеуі өшірулі";
}

function setDeepEnabled(enabled) {
  deepEnabled = enabled;
  localStorage.setItem("sh-deep-v2", enabled ? "on" : "off");
  deepbtn.classList.toggle("on", enabled);
  deepbtn.setAttribute("aria-pressed", String(enabled));
  deepbtn.title = enabled
    ? "Терең жауап режимі қосулы. AI және веб-іздеу провайдер тарифіне сай ақы алуы мүмкін."
    : "Жылдам жауап режимі қосулы";
  modelBadgeText.textContent = enabled ? "Күшті AI · тариф" : "Жылдам AI";
}

setWebEnabled(webEnabled);
setDeepEnabled(deepEnabled);

sndbtn.onclick = sendMsg;
cta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMsg();
  }
});
cta.addEventListener("input", () => {
  cta.style.height = "auto";
  cta.style.height = Math.min(cta.scrollHeight, 140) + "px";
});
document.getElementById("newbtn").onclick = newChat;
document.getElementById("mobbtn").onclick = () =>
  document.getElementById("csb").classList.toggle("open");
chatFileInput.addEventListener("change", async () => {
  const version = ++attachmentVersion,
    scope = captureSession();
  preparingFiles = true;
  sndbtn.disabled = true;
  attachBtn.disabled = true;
  attachmentError.textContent = "Файл өңделуде...";
  attachmentError.dataset.state = "loading";
  try {
    await addAttachments([...chatFileInput.files], version, scope);
    if (version !== attachmentVersion || !scope.valid()) return;
    attachmentError.textContent = "";
  } catch (error) {
    if (version !== attachmentVersion || !scope.valid()) return;
    attachmentError.textContent = error.message;
    attachmentError.dataset.state = "error";
  } finally {
    if (version === attachmentVersion && scope.valid()) {
      preparingFiles = false;
      attachBtn.disabled = false;
      sndbtn.disabled = chatRequestActive;
      chatFileInput.value = "";
    }
  }
});

function newChat() {
  if (chatRequestActive) return;
  attachmentVersion++;
  preparingFiles = false;
  attachBtn.disabled = false;
  sndbtn.disabled = false;
  chatId = null;
  msgs = [];
  answerTexts.clear();
  retryRequests.clear();
  pendingAttachments = [];
  renderPendingAttachments();
  attachmentError.textContent = "";
  msa.innerHTML = "";
  msa.appendChild(mkWelcome());
  hlHist();
  document.getElementById("csb").classList.remove("open");
}

function mkWelcome() {
  const d = document.createElement("div");
  d.className = "welcome";
  d.id = "wlc";
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

function qpu(btn) {
  cta.value = btn.textContent.trim();
  cta.focus();
}

const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Файлды оқу мүмкін болмады"));
    reader.readAsDataURL(file);
  });

const readAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Файлды оқу мүмкін болмады"));
    reader.readAsText(file);
  });

async function prepareImage(file, sourceType) {
  if (file.size > 8 * 1024 * 1024)
    throw new Error(`${file.name}: фото 8 МБ-тан үлкен`);
  if (file.size <= 900 * 1024) {
    const rawDataUrl = String(await readAsDataURL(file));
    const dataUrl = rawDataUrl.replace(
      /^data:[^;]*;base64,/,
      `data:${sourceType};base64,`,
    );
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
    const scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    if (!blob) throw new Error(`${file.name}: суретті өңдеу мүмкін болмады`);
    return {
      dataUrl: await readAsDataURL(blob),
      type: "image/webp",
      size: blob.size,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareAttachment(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const inferredImageType = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  }[extension];
  const imageType = ["image/jpeg", "image/png", "image/webp"].includes(
    file.type,
  )
    ? file.type
    : inferredImageType;
  if (imageType) {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "image",
      ...(await prepareImage(file, imageType)),
    };
  }
  if (file.type === "application/pdf" || extension === "pdf") {
    if (file.size > 2.4 * 1024 * 1024)
      throw new Error(`${file.name}: PDF 2.4 МБ-тан үлкен`);
    const rawDataUrl = String(await readAsDataURL(file));
    const dataUrl = rawDataUrl.replace(
      /^data:[^;]*;base64,/,
      "data:application/pdf;base64,",
    );
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "pdf",
      type: "application/pdf",
      size: file.size,
      dataUrl,
    };
  }
  if (
    ["txt", "md", "csv"].includes(extension) ||
    ["text/plain", "text/markdown", "text/csv"].includes(file.type)
  ) {
    if (file.size > 250 * 1024)
      throw new Error(`${file.name}: мәтіндік файл 250 КБ-тан үлкен`);
    const content = await readAsText(file);
    if (content.length > 20000)
      throw new Error(`${file.name}: мәтін 20 000 таңбадан аспауы керек`);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      kind: "text",
      type: file.type || "text/plain",
      size: file.size,
      content,
    };
  }
  throw new Error(`${file.name}: бұл файл түрі қолдау таппайды`);
}

async function addAttachments(files, version, scope) {
  const slots = 3 - pendingAttachments.length;
  if (slots <= 0)
    throw new Error("Бір хабарламаға ең көбі 3 файл қосуға болады");
  for (const file of files.slice(0, slots)) {
    const attachment = await prepareAttachment(file);
    if (version !== attachmentVersion || !scope.valid()) return;
    const nextDataSize = [...pendingAttachments, attachment].reduce(
      (total, item) => total + (item.dataUrl?.length || 0),
      0,
    );
    if (nextDataSize > 3_200_000)
      throw new Error("Файлдардың жалпы көлемі тым үлкен");
    pendingAttachments.push(attachment);
    renderPendingAttachments();
  }
  renderPendingAttachments();
}

function renderPendingAttachments() {
  attachmentList.replaceChildren();
  pendingAttachments.forEach((attachment) => {
    const chip = document.createElement("div");
    chip.className = "attachment-preview";
    const icon =
      attachment.kind === "image"
        ? "Фото"
        : attachment.kind === "pdf"
          ? "PDF"
          : "TXT";
    chip.innerHTML = `<span class="attachment-kind">${icon}</span><span>${esc(attachment.name)}</span><button type="button" data-action="remove-attachment" data-attachment-id="${attachment.id}" aria-label="${esc(attachment.name)} файлын алып тастау">×</button>`;
    attachmentList.appendChild(chip);
  });
}

function removeAttachment(id) {
  pendingAttachments = pendingAttachments.filter(
    (attachment) => attachment.id !== id,
  );
  renderPendingAttachments();
  attachmentError.textContent = "";
}

function attachmentMetadata(attachments) {
  return attachments.map(({ name, type, kind }) => ({ name, type, kind }));
}

async function sendMsg() {
  const typedText = cta.value.trim();
  if (
    (!typedText && !pendingAttachments.length) ||
    chatRequestActive ||
    preparingFiles
  )
    return;
  const attachments = pendingAttachments;
  const text = typedText || "Осы файлдарды талдап, түсіндір.";
  const metadata = attachmentMetadata(attachments);
  document.getElementById("wlc")?.remove();
  addBubble(text, true, [], "", { attachments: metadata });
  msgs.push({
    role: "user",
    content: text,
    ...(metadata.length ? { attachments: metadata } : {}),
  });
  saveChat(msgs[0]?.content || text);
  cta.value = "";
  cta.style.height = "auto";
  pendingAttachments = [];
  renderPendingAttachments();
  const request = {
    text,
    attachments,
    messages: msgs
      .filter((message) => !message.incomplete)
      .map(({ role, content, attachments }) => ({
        role,
        content,
        ...(attachments?.length ? { attachments } : {}),
      })),
    title: msgs[0]?.content || text,
    web: webEnabled,
    deep: deepEnabled,
  };
  await runAssistantRequest(request);
}

async function runAssistantRequest(request, retryKey = crypto.randomUUID()) {
  const controller = new AbortController();
  activeChatController = controller;
  const scope = captureSession();
  const requestUserId = currentUser?.id;
  chatRequestActive = true;
  sndbtn.disabled = true;
  const bubble = addBubble(request.prefix || "", false, [], "", {
    streaming: true,
  });
  if (!request.prefix)
    bubble.content.innerHTML =
      '<span class="streaming-label">AI жауап дайындауда...</span>';
  let latestText = request.prefix || "";
  let streamMeta = {};
  let paintFrame = null;
  document.getElementById("chatStop").hidden = false;
  let lastPaint = 0;
  let paintedText = "",
    streamingTextNode = null;
  const paint = () => {
    if (performance.now() - lastPaint < 80) {
      paintFrame = requestAnimationFrame(paint);
      return;
    }
    const atBottom = msa.scrollHeight - msa.scrollTop - msa.clientHeight < 120;
    if (!scope.valid()) return;
    // Plain text during streaming avoids repeatedly parsing the accumulated response.
    if (!streamingTextNode) {
      streamingTextNode = document.createTextNode("");
      bubble.content.replaceChildren(streamingTextNode);
    }
    if (latestText.startsWith(paintedText))
      streamingTextNode.appendData(latestText.slice(paintedText.length));
    else streamingTextNode.data = latestText;
    paintedText = latestText;
    answerTexts.set(bubble.content.id, latestText);
    if (atBottom) msa.scrollTop = msa.scrollHeight;
    lastPaint = performance.now();
    paintFrame = null;
  };
  const retainAnswer = (reply, sources, webStatus, incomplete, notice = "") => {
    bubble.content.innerHTML = renderRichText(reply);
    if (hasMath(reply))
      onMathReady(() => {
        if (bubble.content.isConnected)
          bubble.content.innerHTML = renderRichText(reply);
      });
    answerTexts.set(bubble.content.id, reply);
    bubble.element.classList.remove("streaming");
    bubble.extras.innerHTML = assistantExtras(sources, webStatus);
    const saved = {
      role: "assistant",
      content: reply,
      ...(sources.length ? { sources } : {}),
      ...(webStatus ? { webStatus } : {}),
      ...(incomplete ? { incomplete: true } : {}),
    };
    msgs.push(saved);
    if (incomplete) {
      const continuation = {
        ...request,
        prefix: reply,
        messages: [
          ...(request.originalMessages || request.messages),
          { role: "assistant", content: reply },
          {
            role: "user",
            content:
              "Continue exactly where the previous answer stopped. Do not repeat it. Keep the same language and finish the original task.",
          },
        ],
        originalMessages: request.originalMessages || request.messages,
        expectedLastMessage: saved,
        partialMessage: saved,
      };
      retryRequests.set(retryKey, continuation);
      bubble.extras.insertAdjacentHTML(
        "beforeend",
        `<div class="source-status">${esc(notice || "Жауап толық аяқталмады.")}</div><button class="retry-btn" data-action="retry-message" data-retry-key="${esc(retryKey)}">Жалғастыру</button>`,
      );
      // An incomplete answer must not become a test or a set of flashcards.
      bubble.element.querySelectorAll(".study-action").forEach((button) => {
        button.disabled = true;
      });
    } else retryRequests.delete(retryKey);
    saveChat(request.title);
  };
  try {
    const response = await requestAIStream(
      {
        messages: request.messages,
        attachments: request.attachments,
        web: request.web,
        deep: request.deep,
      },
      {
        onMeta: (meta) => {
          if (!scope.valid()) return;
          streamMeta = meta;
          if (meta.stage === "searching")
            bubble.content.textContent = "Дереккөздер ізделуде...";
          if (meta.model) {
            modelBadgeText.title = meta.model;
            modelBadgeText.textContent = meta.fallback
              ? "Резерв AI"
              : request.deep
                ? "Күшті AI · тариф"
                : "Жылдам AI";
          }
        },
        onDelta: (_delta, fullText) => {
          if (!scope.valid()) return;
          latestText = (request.prefix || "") + fullText;
          if (paintFrame === null) paintFrame = requestAnimationFrame(paint);
        },
      },
      { signal: controller.signal, onAuthRequired: () => showAuth("login") },
    );
    if (!scope.valid()) {
      bubble.element.remove();
      return;
    }
    const reply = (request.prefix || "") + response.text;
    const sources = Array.isArray(response.sources)
      ? response.sources
      : streamMeta.sources || [];
    retainAnswer(
      reply,
      sources,
      response.webStatus || streamMeta.webStatus || "",
      response.incomplete === true,
    );
    if (!response.incomplete) {
      addStat("q");
      addXP(10);
      renderStats();
    }
  } catch (error) {
    if (!scope.valid()) {
      bubble.element.remove();
      return;
    }
    if (controller.signal.aborted) {
      if (latestText.trim())
        retainAnswer(
          latestText,
          streamMeta.sources || [],
          "",
          true,
          "Тоқтатылды.",
        );
      else bubble.element.remove();
      return;
    }
    if (latestText.trim()) {
      retainAnswer(
        latestText,
        streamMeta.sources || [],
        streamMeta.webStatus || "",
        true,
        error.message,
      );
    } else {
      bubble.element.remove();
      retryRequests.set(retryKey, {
        ...request,
        expectedLastMessage: msgs.at(-1),
      });
      addBubble(
        error.message || "AI сервисі уақытша қолжетімсіз.",
        false,
        [],
        "",
        { error: true, retryKey },
      );
    }
  } finally {
    if (paintFrame !== null) cancelAnimationFrame(paintFrame);
    if (activeChatController === controller) {
      document.getElementById("chatStop").hidden = true;
      activeChatController = null;
      chatRequestActive = false;
      sndbtn.disabled = false;
    }
  }
}

function assistantExtras(sources = [], webStatus = "") {
  const sourceLinks = sources
    .filter((source) => {
      try {
        return new URL(source?.url).protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 4)
    .map(
      (source, index) =>
        `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer"><span>${index + 1}</span>${esc(source.title || source.provider || "Интернет көзі")}</a>`,
    )
    .join("");
  const webStatusText =
    {
      no_results: "Интернеттен сәйкес дерек табылмады",
      unavailable: "Интернет көздері уақытша қолжетімсіз",
      provider: "Интернеттен іздеу сұралды",
      skipped: "",
    }[webStatus] || "";
  return `${sourceLinks ? `<div class="source-links"><small>Интернет дереккөздері</small>${sourceLinks}</div>` : ""}${webStatusText ? `<div class="source-status">${esc(webStatusText)}</div>` : ""}`;
}

function addBubble(text, isUser, sources = [], webStatus = "", options = {}) {
  const d = document.createElement("div");
  d.className = "msg" + (isUser ? " user" : "");
  if (options.streaming) d.classList.add("streaming");
  if (options.error) d.classList.add("message-error");
  const av = `<div class="mav ${isUser ? "uav" : "aiav"}">${
    isUser
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--tx2)" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 7V14Q20 20 12 23Q4 20 4 14V7Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="2.5" fill="white" fill-opacity=".95"/><path d="M12 4V10" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`
  }</div>`;
  const attachments = Array.isArray(options.attachments)
    ? options.attachments
    : [];
  const attachmentHtml = attachments.length
    ? `<div class="message-attachments">${attachments.map((attachment) => `<span><b>${attachment.kind === "image" ? "Фото" : attachment.kind === "pdf" ? "PDF" : "TXT"}</b>${esc(attachment.name)}</span>`).join("")}</div>`
    : "";
  if (isUser) {
    const uid = "u" + crypto.randomUUID();
    d.innerHTML =
      av +
      `<div class="msg-wrap"><div class="mb ub" id="${uid}">${esc(text)}</div>
      ${attachmentHtml}
      <div class="message-actions" style="justify-content:flex-end">
        <button class="act-btn" title="Көшіру" aria-label="Хабарламаны көшіру" data-action="copy-message" data-message-id="${uid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      </div></div>`;
  } else {
    const rid = "r" + crypto.randomUUID();
    answerTexts.set(rid, text);
    const actions = options.error
      ? `<button class="retry-btn" data-action="retry-message" data-retry-key="${esc(options.retryKey || "")}">Қайта жіберу</button>`
      : `<button class="act-btn" title="Көшіру" aria-label="AI жауабын көшіру" data-action="copy-message" data-message-id="${rid}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <button class="study-action" data-action="answer-to-flashcards" data-message-id="${rid}">Карточкалар</button>
        <button class="study-action" data-action="answer-to-quiz" data-message-id="${rid}">Тест</button>`;
    d.innerHTML =
      av +
      `<div class="msg-wrap"><div class="mb aib" id="${rid}">${options.error ? esc(text) : renderRichText(text)}</div>
      <div class="assistant-extras">${assistantExtras(sources, webStatus)}</div>
      <div class="message-actions">
        ${actions}
      </div></div>`;
  }
  msa.appendChild(d);
  msa.scrollTop = msa.scrollHeight;
  return {
    element: d,
    content: d.querySelector(".mb"),
    extras: d.querySelector(".assistant-extras"),
  };
}

async function retryMessage(control) {
  const key = control.dataset.retryKey;
  const request = retryRequests.get(key);
  if (!request || chatRequestActive) return;
  if (request.expectedLastMessage !== msgs.at(-1)) {
    control.textContent = "Сұрақты жаңа хабарлама ретінде жіберіңіз";
    control.disabled = true;
    return;
  }
  if (request.partialMessage === msgs.at(-1)) msgs.pop();
  control.closest(".msg")?.remove();
  await runAssistantRequest(request, key);
}

async function makeStudyMaterial(kind, messageId) {
  const text =
    answerTexts.get(messageId) ||
    document.getElementById(messageId)?.innerText ||
    "";
  if (!text || chatRequestActive) return;
  if (kind === "flashcards") {
    go("flashcard");
    await createFlashcardsFromText(text);
  } else {
    go("quiz");
    await createQuizFromText(text);
  }
}

function copyMsg(btn, id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => {
    btn.classList.add("copied");
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.classList.remove("copied");
    }, 1500);
  });
}
/* ═══ SUPABASE HISTORY ═══ */
let saveQueue = Promise.resolve(),
  historyCursor = null;
async function saveChat(first) {
  if (!currentUser || !supabaseClient) return;
  const scope = captureSession();
  if (!chatId) chatId = crypto.randomUUID();
  const pages = paginateChatMessages(msgs);
  for (const page of pages.slice(0, -1)) {
    const archived = {
      id: chatId,
      user_id: scope.userId,
      title: String(first || "Сұхбат").slice(0, 40) + " · алдыңғы бөлік",
      messages: structuredClone(page),
      updated_at: new Date().toISOString(),
    };
    stageChatRow(archived);
    hist = [
      {
        id: archived.id,
        title: archived.title,
        updated_at: archived.updated_at,
      },
      ...hist.filter((ch) => ch.id !== archived.id),
    ];
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => (scope.valid() ? saveChatRow(archived) : undefined));
    chatId = crypto.randomUUID();
  }
  msgs = pages.at(-1) || [];
  const row = {
    id: chatId,
    user_id: scope.userId,
    title: String(first || "Сұхбат").slice(0, 40),
    messages: structuredClone(msgs),
    updated_at: new Date().toISOString(),
  };
  stageChatRow(row);
  hist = [
    { id: row.id, title: row.title, updated_at: row.updated_at },
    ...hist.filter((ch) => ch.id !== row.id),
  ];
  renderHist();
  saveQueue = saveQueue
    .catch(() => {})
    .then(async () => {
      if (!scope.valid()) return;
      try {
        const storage = await saveChatRow(row);
        if (scope.valid())
          document.getElementById("chatSaveStatus").textContent =
            storage === "cloud" ? "Сақталды" : "Құрылғыда. Синхрондау күтілуде";
      } catch (error) {
        if (scope.valid())
          document.getElementById("chatSaveStatus").textContent = error.message;
      }
    });
  return saveQueue;
}
async function loadHistory(append = false) {
  if (!currentUser || !supabaseClient) return;
  const scope = captureSession(),
    version = ++historyVersion;
  try {
    const rows = await listChats(append ? historyCursor : null);
    if (!scope.valid() || version !== historyVersion) return;
    historyCursor = rows.nextCursor;
    hist = append
      ? [...new Map([...hist, ...rows].map((row) => [row.id, row])).values()]
      : rows;
    renderHist();
  } catch {}
}
function clearHistUI() {
  historyVersion++;
  historyCursor = null;
  chatOpenVersion++;
  hist = [];
  chatId = null;
  msgs = [];
  answerTexts.clear();
  retryRequests.clear();
  pendingAttachments = [];
  renderPendingAttachments();
  msa.replaceChildren(mkWelcome());
  renderHist();
}
function renderHist() {
  const l = document.getElementById("hlist"),
    e = document.getElementById("hempty");
  l.innerHTML = "";
  if (!hist.length) {
    e && l.appendChild(e);
    return;
  }
  hist.forEach((ch) => {
    const d = document.createElement("button");
    d.className = "hi" + (ch.id === chatId ? " on" : "");
    d.innerHTML = `<div class="hi-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--tx3)" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><span class="hit">${esc(ch.title || "Сұхбат")}</span>`;
    d.onclick = async () => {
      if (chatRequestActive) return;
      const scope = captureSession(),
        version = ++chatOpenVersion;
      let row;
      try {
        row = await readChat(ch.id);
      } catch {
        return;
      }
      if (!scope.valid() || version !== chatOpenVersion) return;
      attachmentVersion++;
      preparingFiles = false;
      attachBtn.disabled = false;
      sndbtn.disabled = false;
      chatId = ch.id;
      msgs = row.messages || [];
      answerTexts.clear();
      retryRequests.clear();
      pendingAttachments = [];
      renderPendingAttachments();
      msa.innerHTML = "";
      msgs.forEach((m) => {
        const bubble = addBubble(
          m.content,
          m.role === "user",
          m.sources,
          m.webStatus,
          { attachments: m.attachments },
        );
        if (m.incomplete && bubble.extras) {
          bubble.extras.insertAdjacentHTML(
            "beforeend",
            '<div class="source-status">Жауап толық аяқталмаған. Қажет болса, сұрақты қайта жіберіңіз.</div>',
          );
          bubble.element.querySelectorAll(".study-action").forEach((button) => {
            button.disabled = true;
          });
        }
      });
      hlHist();
      document.getElementById("csb").classList.remove("open");
    };
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.className = "act-btn";
    remove.setAttribute("aria-label", "Чатты жою");
    remove.onclick = async () => {
      if (!confirm("Чатты біржола жою керек пе?")) return;
      try {
        await deleteChat(ch.id);
        hist = hist.filter((row) => row.id !== ch.id);
        if (chatId === ch.id) newChat();
        renderHist();
      } catch {
        document.getElementById("chatSaveStatus").textContent =
          "Жою орындалмады";
      }
    };
    l.append(d, remove);
  });
}
function hlHist() {
  document
    .querySelectorAll(".hi")
    .forEach((el, i) => el.classList.toggle("on", hist[i]?.id === chatId));
}

/* ═══ BURGER ═══ */
document.getElementById("burger").onclick = () => {
  const open = document.getElementById("nlinks").classList.toggle("open");
  document.getElementById("burger").setAttribute("aria-expanded", String(open));
};
document.addEventListener("smart-helper:auth-required", () =>
  showAuth("login"),
);
document.addEventListener("change", (event) => {
  if (event.target.id === "fcSavedSelect") loadSavedFlashcards();
  if (event.target.id === "quizSavedSelect") loadSavedQuiz();
  if (event.target.id === "planSavedSelect") loadSavedPlan();
});

document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-go],[data-action]");
  if (!control) return;

  if (control.dataset.go) {
    go(control.dataset.go, control.dataset.authTab);
    return;
  }

  const actions = {
    "answer-to-flashcards": () =>
      makeStudyMaterial("flashcards", control.dataset.messageId),
    "answer-to-quiz": () =>
      makeStudyMaterial("quiz", control.dataset.messageId),
    "auth-tab": () => atab(control.dataset.tab),
    "choose-attachments": () => chatFileInput.click(),
    "copy-message": () => copyMsg(control, control.dataset.messageId),
    "flashcard-result": () => fcResult(control.dataset.result),
    "flip-card": () => flipCard(),
    "generate-flashcards": () => genFlashcards(),
    "generate-quiz": () => genQuiz(),
    "google-login": () => doGoogle(),
    login: () => doLogin(),
    logo: () => (currentUser ? go("chat") : showAbout()),
    "next-card": () => nextCard(),
    "next-quiz-question": () => nextQuizQuestion(),
    "quick-prompt": () => qpu(control),
    register: () => doReg(),
    "remove-attachment": () => removeAttachment(control.dataset.attachmentId),
    "reset-quiz": () => resetQuiz(),
    "retry-message": () => retryMessage(control),
    "run-planner": () => runPlanner(),
    "run-tool": () => runTool(control.dataset.tool, control),
    "set-flashcard-subject": () => setFCSubj(control),
    "toggle-deep": () => setDeepEnabled(!deepEnabled),
    "toggle-web": () => setWebEnabled(!webEnabled),
  };
  actions[control.dataset.action]?.();
});

const runTool = (...args) =>
  import("./modules/tools.js").then((module) => module.runTool(...args));
const initPlanner = (...args) =>
  import("./modules/planner.js").then((module) => module.initPlanner(...args));
const loadSavedPlan = (...args) =>
  import("./modules/planner.js").then((module) =>
    module.loadSavedPlan(...args),
  );
const runPlanner = (...args) =>
  import("./modules/planner.js").then((module) => module.runPlanner(...args));
const createFlashcardsFromText = (...args) =>
  import("./modules/flashcards.js").then((module) =>
    module.createFlashcardsFromText(...args),
  );
const fcResult = (...args) =>
  import("./modules/flashcards.js").then((module) => module.fcResult(...args));
const flipCard = (...args) =>
  import("./modules/flashcards.js").then((module) => module.flipCard(...args));
const genFlashcards = (...args) =>
  import("./modules/flashcards.js").then((module) =>
    module.genFlashcards(...args),
  );
const initFlashcards = (...args) =>
  import("./modules/flashcards.js").then((module) =>
    module.initFlashcards(...args),
  );
const loadSavedFlashcards = (...args) =>
  import("./modules/flashcards.js").then((module) =>
    module.loadSavedFlashcards(...args),
  );
const nextCard = (...args) =>
  import("./modules/flashcards.js").then((module) => module.nextCard(...args));
const setFCSubj = (...args) =>
  import("./modules/flashcards.js").then((module) => module.setFCSubj(...args));
const createQuizFromText = (...args) =>
  import("./modules/quiz.js").then((module) =>
    module.createQuizFromText(...args),
  );
const genQuiz = (...args) =>
  import("./modules/quiz.js").then((module) => module.genQuiz(...args));
const initQuiz = (...args) =>
  import("./modules/quiz.js").then((module) => module.initQuiz(...args));
const loadSavedQuiz = (...args) =>
  import("./modules/quiz.js").then((module) => module.loadSavedQuiz(...args));
const nextQuizQuestion = (...args) =>
  import("./modules/quiz.js").then((module) =>
    module.nextQuizQuestion(...args),
  );
const resetQuiz = (...args) =>
  import("./modules/quiz.js").then((module) => module.resetQuiz(...args));
/* ═══ INIT ═══ */
installEnhancements({
  getClient: () => supabaseClient,
  initSupabase,
  stopChat: () => activeChatController?.abort(),
  loadHistory: () => loadHistory(true),
});
authControls = installAuthControls({ onRecovered: () => go("chat") });
installMobileControls(closeMenus);
const callbackFailure = authCallbackError(location);
if (callbackFailure) {
  history.replaceState({}, "", location.pathname + "#auth");
  go("auth");
  document.getElementById("lErr").textContent =
    authErrorMessage(callbackFailure);
} else if (
  hasAuthCallback(location) ||
  localStorage.keys().some((key) => /^sb-.*-auth-token$/.test(key))
)
  initSupabase().catch(showConnectionError);
else if (intendedPage && !["about", "auth"].includes(intendedPage))
  go(intendedPage);
else if (intendedPage === "auth") go("auth");
function showConnectionError(error) {
  console.warn("Account initialization unavailable", error.name);
  showAuth("login");
  const element = document.getElementById("lErr");
  if (element)
    element.textContent =
      "Байланыс орнатылмады. Интернетті тексеріп, «Қайта қосылу» басыңыз.";
  document.getElementById("authReconnect")?.removeAttribute("hidden");
}

function closeMenus() {
  for (const id of ["nlinks", "csb"])
    document.getElementById(id)?.classList.remove("open");
  for (const id of ["burger", "mobbtn"])
    document.getElementById(id)?.setAttribute("aria-expanded", "false");
}
window.addEventListener("popstate", () =>
  go(location.hash.slice(1) || "about"),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#nlinks,#burger,#csb,#mobbtn")) closeMenus();
});

document.addEventListener("smart-helper:resume-job", async ({ detail }) => {
  if (detail.task === "quiz") {
    const m = await import("./modules/quiz.js");
    m.resumeQuiz(detail.payload, detail.id);
  } else if (detail.task === "flashcards") {
    const m = await import("./modules/flashcards.js");
    m.resumeFlashcards(detail.payload, detail.id);
  } else if (detail.task === "planner") runPlanner(detail.id);
});

function moveStudyOptions(page) {
  const options = document.querySelector(".study-options");
  if (!options) return;
  options.hidden =
    !currentUser || !["quiz", "planner", "flashcard"].includes(page);
  if (!options.hidden)
    document
      .querySelector(
        "#pg-" + page + " .study-page-heading, #pg-" + page + " .st",
      )
      .after(options);
}
