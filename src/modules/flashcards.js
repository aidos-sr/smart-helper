import { captureSession, onSessionReset } from "../../lib/session-scope.js";
import { studyText, restoreStudyOptions } from "../utils/study-view.js";
import { safeStorage, readJSON } from "../../lib/safe-storage.js";
import { requestAI, studyProgressText } from "../services/ai.js";
import { addStat, addXP } from "./progress.js";
import {
  fillMaterialSelect,
  readSelectedMaterial,
  persistStudyMaterial,
} from "./library.js";
import { shuffleArr } from "../utils/text.js";

const FC_BANK = {
  math: [
    { q: "Пифагор теоремасы?", a: "a² + b² = c²" },
    { q: "sin(30°) = ?", a: "0.5 = 1/2" },
    { q: "cos(60°) = ?", a: "0.5 = 1/2" },
    { q: "π ≈ ?", a: "3.14159..." },
    { q: "Квадрат теңдеудің дискриминанты?", a: "D = b² − 4ac" },
    { q: "Тікбұрышты үшбұрыштың ауданы?", a: "S = (a × h) / 2" },
  ],
  history: [
    {
      q: "Қазақ хандығы қашан құрылды?",
      a: "1465 жылы, Керей мен Жәнібек хандардың тұсында",
    },
    { q: "Қазақстан тәуелсіздік алған жыл?", a: "1991 жыл, 16 желтоқсан" },
    {
      q: "Ұлы Жібек жолы не болды?",
      a: "Азия мен Еуропаны байланыстырған сауда жолы",
    },
    { q: "Алаш қозғалысы қашан болды?", a: "1917-1920 жж." },
  ],
  science: [
    {
      q: "Фотосинтез дегеніміз не?",
      a: "Өсімдіктердің күн энергиясымен глюкоза синтездеуі",
    },
    {
      q: "Ньютонның 1-ші заңы?",
      a: "Инерция заңы: сыртқы күш болмаса дене күйін сақтайды",
    },
    { q: "Судың химиялық формуласы?", a: "H₂O" },
    { q: "Жарықтың жылдамдығы?", a: "≈ 300,000 км/с" },
    { q: "Атомның ядросы немен тұрады?", a: "Протондар мен нейтрондардан" },
  ],
  kazakh: [
    { q: "Қазақ алфавитіндегі әріп саны?", a: "42 әріп (латынша: 32)" },
    { q: "Абайдың «Қара сөздері» неше?", a: "45 қара сөз" },
    { q: "«Жер» сөзінің орысша аудармасы?", a: "Земля, почва" },
    { q: "«Мен оқушымын» — орысша?", a: "Я ученик / Я студент" },
  ],
};

let fcCards = [...FC_BANK.math],
  fcIdx = 0,
  fcSubj = "math",
  fcCorrect = 0,
  fcTotal = 0;

const reviewed = new Set();
let flipped = false;
let generationVersion = 0,
  generationController = null;
export function cancelFlashcards() {
  generationVersion++;
  generationController?.abort();
  generationController = null;
  const btn = document.getElementById("fcGenBtn");
  btn.disabled = false;
  btn.textContent = "AI карточкалар жасау";
}
onSessionReset(() => {
  cancelFlashcards();
  fcCards = [...FC_BANK.math];
  fcIdx = 0;
  fcCorrect = 0;
  fcTotal = 0;
  reviewed.clear();
});

function setStatus(text, state = "") {
  const status = document.getElementById("fcGenStatus");
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

export function initFlashcards() {
  if (!fcCards.length) loadFCSubj(fcSubj);
  else showCard();
  fillMaterialSelect("fcSavedSelect", "flashcards").catch((error) => {
    console.warn(
      "Flashcard library load failed",
      error?.code || error?.message,
    );
  });
}

export function setFCSubj(btn) {
  cancelFlashcards();
  document
    .querySelectorAll(".fc-subj")
    .forEach((item) => item.classList.remove("on"));
  btn.classList.add("on");
  fcSubj = btn.dataset.subj;
  loadFCSubj(fcSubj);
}

function loadFCSubj(subj) {
  fcCards = [...(FC_BANK[subj] || FC_BANK.math)];
  shuffleArr(fcCards);
  const mastery = readJSON("sh-mastery:" + captureSession().userId, {});
  fcCards.sort((a, b) => (mastery[a.q]?.due || 0) - (mastery[b.q]?.due || 0));
  fcIdx = 0;
  fcCorrect = 0;
  fcTotal = 0;
  showCard();
}

function showCard() {
  if (!fcCards.length) return;
  const card = fcCards[fcIdx % fcCards.length];
  studyText(document.getElementById("fcQuestion"), card.q);
  studyText(document.getElementById("fcAnswer"), card.a);
  flipped = false;
  document.querySelector(".fc-front").setAttribute("aria-hidden", "false");
  document.querySelector(".fc-back").setAttribute("aria-hidden", "true");
  document
    .querySelector("[data-action=flip-card]")
    ?.setAttribute("aria-pressed", "false");
  document.getElementById("cardInner").classList.remove("flipped");
  document.getElementById("fcProgress").textContent =
    `${fcIdx + 1} / ${fcCards.length}`;
}

export function flipCard() {
  flipped = !flipped;
  document
    .querySelector(".fc-front")
    .setAttribute("aria-hidden", String(flipped));
  document
    .querySelector(".fc-back")
    .setAttribute("aria-hidden", String(!flipped));
  document.getElementById("cardInner").classList.toggle("flipped", flipped);
  document
    .querySelector("[data-action=flip-card]")
    ?.setAttribute("aria-pressed", String(flipped));
}
export function fcResult(type) {
  if (!flipped) return;
  const key = fcCards[fcIdx]?.q,
    owner = captureSession().userId;
  const mastery = readJSON("sh-mastery:" + owner, {}),
    previous = mastery[key];
  if (!reviewed.has(key) && (!previous || previous.due <= Date.now())) {
    reviewed.add(key);
    addStat("card", 1);
    addXP(5);
  }
  const interval =
    type === "good" ? Math.min(30, (previous?.interval || 0) * 2 + 1) : 1;
  mastery[key] = { interval, due: Date.now() + interval * 86400000 };
  safeStorage.setItem("sh-mastery:" + owner, JSON.stringify(mastery));
  if (type === "good") fcCorrect++;
  fcTotal++;
  nextCard();
}
export function nextCard() {
  const mastery = readJSON("sh-mastery:" + captureSession().userId, {});
  let next = (fcIdx + 1) % fcCards.length;
  for (let step = 1; step <= fcCards.length; step++) {
    const index = (fcIdx + step) % fcCards.length;
    if ((mastery[fcCards[index].q]?.due || 0) <= Date.now()) {
      next = index;
      break;
    }
  }
  fcIdx = next;
  showCard();
  const due = fcCards.filter(
    (card) => (mastery[card.q]?.due || 0) <= Date.now(),
  ).length;
  if (!due)
    document.getElementById("fcProgress").textContent =
      "Бүгінгі қайталау аяқталды. Келесі: " +
      new Date(
        Math.min(...fcCards.map((card) => mastery[card.q]?.due || Date.now())),
      ).toLocaleDateString();
}

async function generateFlashcards(topic, sourceText = "", operationId) {
  if (!topic) {
    setStatus("Тақырып жазыңыз", "error");
    document.getElementById("fcGenTopic").focus();
    return false;
  }
  const btn = document.getElementById("fcGenBtn");
  if (btn.disabled) return false;
  const version = ++generationVersion,
    scope = captureSession();
  generationController = new AbortController();
  const signal = generationController.signal;
  btn.disabled = true;
  btn.textContent = "Жасалуда...";
  setStatus("1/3 · Сұрау AI-ға жіберілді", "loading");
  try {
    setStatus("2/3 · AI карточкаларды құруда", "loading");
    const specification = { topic, sourceText, ...studyOptions() };
    const response = await requestAI("flashcards", specification, {
      signal,
      operationId,
      onProgress: (event) => {
        if (version === generationVersion)
          setStatus(studyProgressText(event), "loading");
      },
    });
    if (version !== generationVersion || !scope.valid()) return;
    const parsed = response.data;
    if (!Array.isArray(parsed?.cards) || !parsed.cards.length)
      throw new Error("Карточкалар алынбады");
    fcCards = parsed.cards;
    fcIdx = 0;
    fcCorrect = 0;
    fcTotal = 0;
    showCard();
    document.getElementById("fcGenTopic").value = "";
    persistStudyMaterial(
      "flashcards",
      topic,
      {
        topic,
        sourceText,
        specification,
        cards: fcCards,
        provenance: response.provenance,
      },
      "fcSavedSelect",
      (text, state) => {
        if (version === generationVersion && scope.valid())
          setStatus(text, state);
      },
      scope.userId,
      response.jobId,
    );
    return true;
  } catch (error) {
    if (
      version !== generationVersion ||
      !scope.valid() ||
      error.name === "AbortError"
    )
      return false;
    setStatus(error.message || "Қате орын алды", "error");
    return false;
  } finally {
    if (version !== generationVersion || !scope.valid()) return;
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> AI карточкалар жасау`;
  }
}

export async function genFlashcards() {
  return generateFlashcards(document.getElementById("fcGenTopic").value.trim());
}

export async function createFlashcardsFromText(text) {
  document.getElementById("fcGenTopic").value = String(text || "")
    .trim()
    .slice(0, 7000);
  return generateFlashcards(
    "Берілген мәтін бойынша карточкалар",
    document.getElementById("fcGenTopic").value,
  );
}

export async function loadSavedFlashcards() {
  cancelFlashcards();
  const selectedVersion = generationVersion,
    selectedScope = captureSession();
  try {
    const saved = await readSelectedMaterial("fcSavedSelect");
    if (selectedVersion !== generationVersion || !selectedScope.valid()) return;
    if (saved) restoreStudyOptions(saved);
    if (!Array.isArray(saved?.cards) || !saved.cards.length) return;
    fcCards = saved.cards;
    fcIdx = 0;
    fcCorrect = 0;
    fcTotal = 0;
    showCard();
    setStatus("Сақталған карточкалар ашылды", "success");
  } catch (error) {
    if (selectedVersion === generationVersion && selectedScope.valid())
      setStatus("Материал ашылмады: " + error.message, "error");
  }
}

function studyOptions() {
  return {
    variant: document.getElementById("studyVariant")?.value || "",
    grade: document.getElementById("studyGrade")?.value || "",
    difficulty: document.getElementById("studyDifficulty")?.value || "medium",
    language: document.getElementById("studyLanguage")?.value || "kk",
  };
}

export function resumeFlashcards(payload, operationId) {
  return generateFlashcards(
    payload.topic,
    payload.sourceText || "",
    operationId,
  );
}
