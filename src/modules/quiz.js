import { normalizeStructuredResult } from "../../lib/structured-results.js";
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

let quizQuestions = [],
  quizCurrent = 0,
  quizScore = 0,
  quizTopic = "";
let quizAnswered = false,
  quizFinished = false,
  quizAnswers = [],
  quizId = "",
  generationPending = false,
  targetCount = 0;
let partialBatches = new Map();
function saveAttempt() {
  const scope = captureSession();
  if (scope.userId)
    safeStorage.setItem(
      "sh-attempt:" + scope.userId,
      JSON.stringify({
        quizQuestions,
        quizCurrent,
        quizScore,
        quizTopic,
        quizAnswers,
        quizId,
        quizFinished,
        generationPending,
        targetCount,
      }),
    );
}

let generationVersion = 0,
  generationController = null;
export function cancelQuiz() {
  generationPending = false;
  generationVersion++;
  generationController?.abort();
  generationController = null;
  const btn = document.getElementById("quizGenBtn");
  btn.disabled = false;
  btn.textContent = "Тест жасау";
}
onSessionReset(() => {
  cancelQuiz();
  quizQuestions = [];
  quizCurrent = 0;
  quizScore = 0;
  quizTopic = "";
  quizAnswers = [];
  generationPending = false;
  partialBatches.clear();
});

function setStatus(text, state = "") {
  const status = document.getElementById("quizGenStatus");
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

export function initQuiz() {
  const scope = captureSession();
  const previous = readJSON("sh-attempt:" + scope.userId, null);
  if (
    !quizQuestions.length &&
    previous?.quizQuestions?.length &&
    !previous.quizFinished
  ) {
    import("./library.js").then(({ validateMaterial }) => {
      try {
        scope.assert();
        validateMaterial("quiz", { questions: previous.quizQuestions });
        quizQuestions = previous.quizQuestions;
        quizCurrent = previous.quizCurrent;
        quizScore = previous.quizScore;
        quizTopic = previous.quizTopic;
        quizAnswers = previous.quizAnswers || [];
        quizId = previous.quizId;
        generationPending = previous.generationPending === true;
        targetCount = previous.targetCount || quizQuestions.length;
        openQuiz();
      } catch {}
    });
  }
  fillMaterialSelect("quizSavedSelect", "quiz").catch((error) => {
    console.warn("Quiz library load failed", error?.code || error?.message);
  });
}

async function generateQuiz(
  topic,
  count,
  sourceText = "",
  operationId,
  legacyGrade,
) {
  if (!topic) {
    setStatus("Тақырып жазыңыз", "error");
    document.getElementById("quizTopic").focus();
    return false;
  }
  const btn = document.getElementById("quizGenBtn");
  if (btn.disabled) return false;
  const version = ++generationVersion,
    scope = captureSession();
  generationController = new AbortController();
  const signal = generationController.signal;
  const preserveAttempt = Boolean(
    operationId && quizTopic === topic && quizQuestions.length,
  );
  generationPending = true;
  targetCount = Number(count);
  partialBatches = new Map();
  if (!preserveAttempt) {
    quizQuestions = [];
    quizCurrent = 0;
    quizScore = 0;
    quizAnswers = [];
    quizTopic = topic;
    quizId = operationId || crypto.randomUUID();
  }
  btn.disabled = true;
  btn.textContent = "Жасалуда...";
  setStatus("1/3 · Сұрау AI-ға жіберілді", "loading");
  try {
    setStatus("2/3 · AI сұрақтар мен түсіндірмелерді құруда", "loading");
    const specification = {
      topic,
      count: Number(count),
      sourceText,
      ...studyOptions(legacyGrade),
    };
    const response = await requestAI("quiz", specification, {
      signal,
      operationId,
      onPartial: (event) => {
        if (version !== generationVersion || !scope.valid()) return;
        try {
          const questions = normalizeStructuredResult(
            "quiz",
            event.data,
            { count: event.data.questions.length, sourceText },
            { batch: true },
          ).questions;
          partialBatches.set(event.index, questions);
          let combined = [];
          for (let i = 0; partialBatches.has(i); i++)
            combined.push(...partialBatches.get(i));
          const previousCount = quizQuestions.length;
          quizQuestions = combined;
          saveAttempt();
          if (previousCount === 0) openQuiz();
          else if (quizCurrent >= previousCount) showQuizQ();
          setStatus(
            `${quizQuestions.length}/${targetCount} · Тест жалғасуда`,
            "loading",
          );
        } catch {
          setStatus("Дайын бөліктің пішімі қате", "error");
        }
      },
      onProgress: (event) => {
        if (version === generationVersion)
          setStatus(studyProgressText(event), "loading");
      },
    });
    if (version !== generationVersion || !scope.valid()) return;
    const parsed = response.data;
    if (!Array.isArray(parsed?.questions) || !parsed.questions.length)
      throw new Error("Тест алынбады");
    const hadPartial = quizQuestions.length > 0;
    quizQuestions = parsed.questions;
    generationPending = false;
    quizId = response.jobId || quizId;
    saveAttempt();
    if (!hadPartial) openQuiz();
    else if (quizCurrent >= quizQuestions.length) showQuizResult();
    persistStudyMaterial(
      "quiz",
      topic,
      {
        topic,
        sourceText,
        specification,
        questions: quizQuestions,
        provenance: response.provenance,
      },
      "quizSavedSelect",
      (text, state) => {
        if (version === generationVersion && scope.valid())
          setStatus(text, state);
      },
      scope.userId,
      quizId,
    );
    return true;
  } catch (error) {
    if (
      version !== generationVersion ||
      !scope.valid() ||
      error.name === "AbortError"
    )
      return false;
    generationPending = false;
    saveAttempt();
    setStatus(
      (quizQuestions.length
        ? `${quizQuestions.length}/${targetCount} сұрақ сақталды. «Аяқталмаған тапсырманы жалғастыру» басыңыз. `
        : "") + (error.message || "Қате орын алды"),
      "error",
    );
    return false;
  } finally {
    if (version !== generationVersion || !scope.valid()) return;
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Тест жасау`;
  }
}

export async function genQuiz() {
  const topic = document.getElementById("quizTopic").value.trim();
  const count = document.getElementById("quizCount").value;
  return generateQuiz(topic, count);
}

export async function createQuizFromText(text) {
  const topic = String(text || "")
    .trim()
    .slice(0, 7000);
  document.getElementById("quizTopic").value = topic;
  return generateQuiz("Берілген мәтін бойынша тест", 5, topic);
}

function openQuiz() {
  quizAnswered = false;
  quizFinished = false;
  document.getElementById("quizSetup").style.display = "none";
  document.getElementById("quizResult").style.display = "none";
  document.getElementById("quizActive").style.display = "block";
  showQuizQ();
}

function showQuizQ() {
  if (quizCurrent >= quizQuestions.length) {
    if (generationPending || quizQuestions.length < targetCount) {
      document.getElementById("quizQ").textContent =
        "Келесі бөлік күтілуде. Жалғастыру үшін тапсырма күйін тексеріңіз.";
      document.getElementById("quizOpts").replaceChildren();
      document.getElementById("quizNextBtn").hidden = true;
      return;
    }
    showQuizResult();
    return;
  }
  quizAnswered = false;
  const q = quizQuestions[quizCurrent],
    total = quizQuestions.length;
  document.getElementById("quizNum").textContent =
    `Сұрақ ${quizCurrent + 1} / ${total}`;
  studyText(document.getElementById("quizQ"), q.q);
  document.getElementById("quizQ").tabIndex = -1;
  document.getElementById("quizQ").setAttribute("aria-describedby", "quizNum");
  document.getElementById("quizQ").focus();
  document
    .getElementById("quizProgressFill")
    .parentElement.setAttribute("role", "progressbar");
  document
    .getElementById("quizProgressFill")
    .parentElement.setAttribute("aria-label", "Тест барысы");
  document
    .getElementById("quizProgressFill")
    .parentElement.setAttribute("aria-valuenow", String(quizCurrent));
  document
    .getElementById("quizProgressFill")
    .parentElement.setAttribute("aria-valuemax", String(total));
  document.getElementById("quizProgressFill").style.width =
    (quizCurrent / total) * 100 + "%";
  const explanation = document.getElementById("quizExplanation");
  explanation.hidden = true;
  explanation.style.display = "none";
  explanation.textContent = "";
  explanation.dataset.result = "";
  const nextButton = document.getElementById("quizNextBtn");
  nextButton.hidden = true;
  nextButton.style.display = "none";
  const opts = document.getElementById("quizOpts");
  opts.innerHTML = "";
  ["А", "Б", "В", "Г"].forEach((label, index) => {
    const btn = document.createElement("button");
    btn.className = "quiz-opt";
    studyText(btn, `${label}. ${q.opts[index]}`);
    btn.addEventListener("click", () => answerQuiz(index));
    opts.appendChild(btn);
  });
  if (Number.isInteger(quizAnswers[quizCurrent])) {
    quizAnswered = true;
    const selected = quizAnswers[quizCurrent];
    opts.querySelectorAll("button").forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.toggle("correct", i === q.correct);
      btn.classList.toggle("wrong", i === selected && i !== q.correct);
    });
    explanation.hidden = false;
    explanation.style.display = "";
    studyText(explanation, q.explanation);
    nextButton.hidden = false;
    nextButton.style.display = "";
  }
}

function answerQuiz(index) {
  if (quizAnswered || quizFinished || !quizQuestions[quizCurrent]) return;
  quizAnswered = true;
  const q = quizQuestions[quizCurrent],
    btns = document.querySelectorAll(".quiz-opt");
  btns.forEach((button) => {
    button.classList.add("disabled");
    button.disabled = true;
  });
  btns[q.correct]?.classList.add("correct");
  const isCorrect = index === q.correct;
  quizAnswers[quizCurrent] = index;
  if (isCorrect) {
    quizScore++;
    addXP(15);
  } else {
    btns[index]?.classList.add("wrong");
  }
  saveAttempt();
  document.getElementById("quizProgressFill").style.width =
    ((quizCurrent + 1) / quizQuestions.length) * 100 + "%";
  const explanation = document.getElementById("quizExplanation");
  explanation.hidden = false;
  explanation.style.display = "";
  explanation.dataset.result = isCorrect ? "correct" : "wrong";
  const explanationText = isCorrect
    ? `Дұрыс! ${q.explanation || ""}`.trim()
    : `Неге қате: ${q.explanation || `Дұрыс жауап — ${q.opts[q.correct]}.`}`;
  studyText(explanation, explanationText);
  const nextButton = document.getElementById("quizNextBtn");
  nextButton.hidden = false;
  nextButton.style.display = "";
}

export function nextQuizQuestion() {
  if (!quizAnswered || quizFinished) return;
  quizCurrent++;
  saveAttempt();
  showQuizQ();
}

function showQuizResult() {
  if (quizFinished) return;
  quizFinished = true;
  document.getElementById("quizActive").style.display = "none";
  document.getElementById("quizResult").style.display = "block";
  const pct = Math.round((quizScore / quizQuestions.length) * 100);
  document.getElementById("quizScoreN").textContent =
    `${quizScore}/${quizQuestions.length}`;
  document.getElementById("quizScoreMsg").textContent = [
    "Жалғастыр!",
    "Жаман емес!",
    "Жақсы!",
    "Өте жақсы!",
    "Керемет!",
  ][Math.min(4, Math.floor(pct / 20))];
  addStat("quiz", 1);
  addXP(quizScore * 5);
  saveAttempt();
  const review = document.createElement("div");
  review.id = "quizReview";
  document.getElementById("quizReview")?.remove();
  quizQuestions.forEach((q, i) => {
    const item = document.createElement("div");
    item.className = "quiz-explanation";
    studyText(
      item,
      `${i + 1}. ${q.q}\nСіздің жауабыңыз: ${q.opts[quizAnswers[i]] || "—"}\nДұрыс жауап: ${q.opts[q.correct]}\n${q.explanation}`,
    );
    review.append(item);
  });
  document.getElementById("quizResult").append(review);
  const history = readJSON("sh-attempt-history:" + captureSession().userId, []);
  history.unshift({
    id: quizId,
    topic: quizTopic,
    score: quizScore,
    total: quizQuestions.length,
    at: new Date().toISOString(),
  });
  safeStorage.setItem(
    "sh-attempt-history:" + captureSession().userId,
    JSON.stringify(history.slice(0, 100)),
  );
  const past = document.createElement("p");
  past.textContent =
    "Соңғы талпыныстар: " +
    history
      .slice(0, 5)
      .map(
        (attempt) =>
          `${attempt.score}/${attempt.total} (${new Date(attempt.at).toLocaleDateString()})`,
      )
      .join(" · ");
  review.append(past);
  const retry = document.createElement("button");
  retry.className = "btn";
  retry.textContent = "Қате сұрақтарды қайталау";
  retry.onclick = () => {
    quizQuestions = quizQuestions.filter(
      (q, i) => quizAnswers[i] !== q.correct,
    );
    quizCurrent = 0;
    quizScore = 0;
    quizAnswers = [];
    if (quizQuestions.length) openQuiz();
  };
  review.append(retry);
}

export async function loadSavedQuiz() {
  cancelQuiz();
  const selectedVersion = generationVersion,
    selectedScope = captureSession();
  try {
    const saved = await readSelectedMaterial("quizSavedSelect");
    if (selectedVersion !== generationVersion || !selectedScope.valid()) return;
    if (saved) restoreStudyOptions(saved);
    if (!Array.isArray(saved?.questions) || !saved.questions.length) return;
    targetCount = saved.questions.length;
    generationPending = false;
    quizQuestions = saved.questions;
    quizCurrent = 0;
    quizScore = 0;
    quizTopic = saved.topic || "";
    quizId = saved.materialId;
    quizAnswers = [];
    openQuiz();
    setStatus("Сақталған тест ашылды", "success");
  } catch (error) {
    if (selectedVersion === generationVersion && selectedScope.valid())
      setStatus("Материал ашылмады: " + error.message, "error");
  }
}

export function resetQuiz() {
  cancelQuiz();
  quizQuestions = [];
  quizAnswers = [];
  quizScore = 0;
  quizCurrent = 0;
  quizFinished = false;
  safeStorage.removeItem("sh-attempt:" + captureSession().userId);
  document.getElementById("quizResult").style.display = "none";
  document.getElementById("quizActive").style.display = "none";
  document.getElementById("quizSetup").style.display = "block";
  if (quizTopic) document.getElementById("quizTopic").value = quizTopic;
}

function studyOptions(legacyGrade) {
  return {
    variant: document.getElementById("studyVariant")?.value || "",
    ...(legacyGrade ? { grade: legacyGrade } : {}),
    difficulty: document.getElementById("studyDifficulty")?.value || "medium",
    language: document.getElementById("studyLanguage")?.value || "kk",
  };
}

export function resumeQuiz(payload, operationId) {
  return generateQuiz(
    payload.topic,
    payload.count,
    payload.sourceText || "",
    operationId,
    payload.grade,
  );
}
