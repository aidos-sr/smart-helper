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

let activePlan = null;
let generationVersion = 0,
  generationController = null;
export function cancelPlanner() {
  generationVersion++;
  generationController?.abort();
  generationController = null;
  const btn = document.getElementById("planBtn");
  btn.disabled = false;
  btn.textContent = "Жоспар жасау";
}
onSessionReset(() => {
  cancelPlanner();
  activePlan = null;
});

function setStatus(text, state = "") {
  const status = document.getElementById("planStatus");
  if (!status) return;
  status.textContent = text;
  status.dataset.state = state;
}

export function initPlanner() {
  fillMaterialSelect("planSavedSelect", "planner").catch((error) => {
    console.warn("Planner library load failed", error?.code || error?.message);
  });
}

export async function runPlanner(operationId, legacyGrade) {
  const topic = document.getElementById("planTopic").value.trim();
  const goal = document.getElementById("planGoal").value.trim();
  const days = document.getElementById("planDays").value;
  const hours = document.getElementById("planHours").value;
  if (!topic) {
    setStatus("Тақырып жазыңыз", "error");
    return;
  }
  const btn = document.getElementById("planBtn");
  if (btn.disabled) return;
  const version = ++generationVersion,
    scope = captureSession();
  generationController = new AbortController();
  const signal = generationController.signal;
  btn.disabled = true;
  btn.textContent = "Жасалуда...";
  const result = document.getElementById("planResult");
  result.innerHTML =
    '<div class="plan-empty"><span class="tloading" style="display:inline-flex">AI жоспар құруда...</span></div>';
  setStatus("1/3 · Сұрау AI-ға жіберілді", "loading");
  try {
    setStatus("2/3 · AI күндер мен тапсырмаларды құруда", "loading");
    const specification = {
      topic,
      goal,
      days: Number(days),
      hours: Number(hours),
      ...studyOptions(legacyGrade),
    };
    const response = await requestAI("planner", specification, {
      signal,
      operationId,
      onProgress: (event) => {
        if (version === generationVersion)
          setStatus(studyProgressText(event), "loading");
      },
    });
    if (version !== generationVersion || !scope.valid()) return;
    const plan = response.data;
    if (!Array.isArray(plan?.days) || !plan.days.length)
      throw new Error("Жоспар алынбады");
    activePlan = {
      materialId: response.jobId || crypto.randomUUID(),
      specification,
      topic,
      goal,
      provenance: response.provenance,
      hours: Number(hours),
      startDate:
        document.getElementById("planStart")?.value ||
        new Date().toISOString().slice(0, 10),
      days: plan.days,
      completed: [],
    };
    renderPlan(plan.days, result);
    addStat("plan", 1);
    addXP(20);
    persistStudyMaterial(
      "planner",
      topic,
      activePlan,
      "planSavedSelect",
      (text, state) => {
        if (version === generationVersion && scope.valid())
          setStatus(text, state);
      },
      scope.userId,
      activePlan.materialId,
    );
  } catch (error) {
    if (
      version !== generationVersion ||
      !scope.valid() ||
      error.name === "AbortError"
    )
      return false;
    result.textContent = error.message || "Қате орын алды.";
    result.style.color = "var(--ac4)";
    result.style.padding = "16px";
    setStatus(error.message || "Қате орын алды", "error");
  } finally {
    if (version !== generationVersion || !scope.valid()) return;
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Жоспар жасау`;
  }
}

export async function loadSavedPlan() {
  cancelPlanner();
  const selectedVersion = generationVersion,
    selectedScope = captureSession();
  try {
    const saved = await readSelectedMaterial("planSavedSelect");
    if (selectedVersion !== generationVersion || !selectedScope.valid()) return;
    if (saved) restoreStudyOptions(saved);
    if (!Array.isArray(saved?.days) || !saved.days.length) return;
    activePlan = saved;
    document.getElementById("planDays").value = saved.days.length;
    document.getElementById("planHours").value = saved.hours || 2;
    if (document.getElementById("planStart"))
      document.getElementById("planStart").value = saved.startDate || "";
    document.getElementById("planTopic").value = saved.topic || "";
    document.getElementById("planGoal").value = saved.goal || "";
    renderPlan(saved.days, document.getElementById("planResult"));
    setStatus("Сақталған жоспар ашылды", "success");
  } catch (error) {
    if (selectedVersion === generationVersion && selectedScope.valid())
      setStatus("Материал ашылмады: " + error.message, "error");
  }
}

function renderPlan(days, result) {
  const tags = {
    math: "tag-math",
    sci: "tag-sci",
    hist: "tag-hist",
    gen: "tag-gen",
  };
  const labels = {
    math: "Математика",
    sci: "Ғылым",
    hist: "Тарих",
    gen: "Жалпы",
  };
  result.replaceChildren();
  result.style.color = "";
  result.style.padding = "";
  days.forEach((day) => {
    const item = document.createElement("div");
    item.className = "plan-item";
    const dayBox = document.createElement("div");
    dayBox.className = "plan-day";
    const dayNumber = document.createElement("div");
    dayNumber.className = "plan-day-n";
    dayNumber.textContent = String(day.day);
    const dayLabel = document.createElement("div");
    dayLabel.className = "plan-day-l";
    dayLabel.textContent = "КҮН";
    dayBox.append(dayNumber, dayLabel);
    const content = document.createElement("div");
    content.className = "plan-content";
    const title = document.createElement("h4");
    studyText(title, day.title);
    const tasks = document.createElement("div");
    studyText(tasks, day.tasks);
    const tag = document.createElement("span");
    const subject = Object.hasOwn(tags, day.subject) ? day.subject : "gen";
    tag.className = `plan-tag ${tags[subject]}`;
    tag.textContent = labels[subject];
    const done = document.createElement("input");
    done.type = "checkbox";
    done.setAttribute("aria-label", `${day.day} күн орындалды`);
    done.checked = activePlan?.completed?.includes(day.day) || false;
    if (activePlan?.startDate) {
      const date = new Date(activePlan.startDate + "T12:00:00");
      date.setDate(
        date.getDate() + day.day - 1 + (activePlan.offsets?.[day.day] || 0),
      );
      dayLabel.textContent = date.toLocaleDateString();
    }
    done.onchange = () => {
      if (!activePlan) return;
      activePlan.completed = [
        ...new Set([
          ...(activePlan.completed || []).filter((n) => n !== day.day),
          ...(done.checked ? [day.day] : []),
        ]),
      ];
      persistStudyMaterial(
        "planner",
        activePlan.topic,
        activePlan,
        "planSavedSelect",
        setStatus,
        captureSession().userId,
        activePlan.materialId,
      );
    };
    const postpone = document.createElement("button");
    postpone.type = "button";
    postpone.className = "nghost";
    postpone.textContent = "Келесі күнге";
    postpone.onclick = () => {
      if (!activePlan) return;
      activePlan.offsets = {
        ...activePlan.offsets,
        [day.day]: (activePlan.offsets?.[day.day] || 0) + 1,
      };
      persistStudyMaterial(
        "planner",
        activePlan.topic,
        activePlan,
        "planSavedSelect",
        setStatus,
        captureSession().userId,
        activePlan.materialId,
      );
      renderPlan(activePlan.days, result);
    };
    content.append(done, title, tasks, tag, postpone);
    item.append(dayBox, content);
    result.appendChild(item);
  });
}

function studyOptions(legacyGrade) {
  return {
    variant: document.getElementById("studyVariant")?.value || "",
    ...(legacyGrade ? { grade: legacyGrade } : {}),
    difficulty: document.getElementById("studyDifficulty")?.value || "medium",
    language: document.getElementById("studyLanguage")?.value || "kk",
  };
}
