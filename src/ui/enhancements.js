import { requestAccount } from "../services/account.js";
const cancelModules = {
  quiz: () => import("../modules/quiz.js"),
  flashcards: () => import("../modules/flashcards.js"),
  planner: () => import("../modules/planner.js"),
};
import { captureSession, onSessionReset } from "../../lib/session-scope.js";
import { safeStorage } from "../../lib/safe-storage.js";
import {
  arrangeMaterialLibrary,
  attachStopAction,
  createStudyOptions,
  ensureStudyHeading,
  installActionMenus,
  styleAction,
} from "./study-controls.js";
const $ = (id) => document.getElementById(id);
const status = (text) => {
  const el = $("appStatus");
  if (el) el.textContent = text;
};
function button(text, fn) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "sh-button sh-button--secondary";
  el.textContent = text;
  el.onclick = () =>
    Promise.resolve()
      .then(fn)
      .catch((error) => status(error.message));
  return el;
}
export function download(name, data, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function clearPrivateUI() {
  for (const id of [
    "planResult",
    "quizQ",
    "quizOpts",
    "quizReview",
    "quizExplanation",
    "fcQuestion",
    "fcAnswer",
    "sumOut",
    "transOut",
    "fixOut",
    "quizGenStatus",
    "fcGenStatus",
    "planStatus",
    "chatSaveStatus",
    "attachmentError",
    "quotaStatus",
    "chatQuotaStatus",
    "appStatus",
    "quizScoreN",
    "quizScoreMsg",
    "quizNum",
    "fcProgress",
    "xpCurrent",
    "xpInfo",
    "stTotal",
    "stToday",
    "rStreak",
    "achievGrid",
    "xpBadges",
  ]) {
    $(id)?.replaceChildren();
  }
  document
    .querySelectorAll(".saved-select")
    .forEach((el) => el.replaceChildren());
  document
    .querySelectorAll("input:not([type=checkbox]),textarea")
    .forEach((el) => {
      if (el.type !== "file") el.value = el.defaultValue;
      else el.value = "";
    });
  document
    .querySelectorAll(
      ".tool-card button,.planner-form button,.fc-gen-area button",
    )
    .forEach((el) => (el.disabled = false));
  for (const id of ["quizActive", "quizResult"]) $(id).style.display = "none";
  $("quizSetup").style.display = "block";
}
export function installEnhancements({
  getClient,
  initSupabase,
  stopChat,
  loadHistory,
}) {
  document.addEventListener("smart-helper:rate-limit", ({ detail }) => {
    const scope = captureSession(),
      selector =
        '#sndbtn,[data-action="generate-quiz"],[data-action="generate-flashcards"],[data-action="run-planner"],[data-action="run-tool"]';
    window.setTimeout(() => {
      if (!scope.valid()) return;
      for (const btn of document.querySelectorAll(selector)) {
        btn.disabled = true;
        btn.dataset.retryAt = String(detail.until);
        btn.title =
          "Қайта сұрау: " + new Date(detail.until).toLocaleTimeString();
      }
    }, 0);
    window.setTimeout(
      () => {
        if (!scope.valid()) return;
        for (const btn of document.querySelectorAll(selector))
          if (Number(btn.dataset.retryAt) <= Date.now()) {
            btn.disabled = false;
            delete btn.dataset.retryAt;
          }
      },
      Math.max(1, detail.until - Date.now()),
    );
  });
  const live = document.createElement("div");
  live.id = "appStatus";
  live.role = "status";
  live.className = "app-status";
  document.body.append(live);
  installActionMenus();
  // Associate every existing visual label and give permanent accessible names.
  document.querySelectorAll("label").forEach((label) => {
    const input = label.nextElementSibling;
    if (input?.matches("input,select,textarea") && input.id)
      label.htmlFor = input.id;
  });
  document.querySelectorAll("input,textarea,select").forEach((el) => {
    if (!el.labels?.length && !el.hasAttribute("aria-label"))
      el.setAttribute("aria-label", el.placeholder || el.id);
  });
  for (const [id, name, controls] of [
    ["tbtn", "Тақырып түсін ауыстыру"],
    ["burger", "Мәзір", "nlinks"],
    ["mobbtn", "Чат тарихы", "csb"],
  ]) {
    const el = $(id);
    el.setAttribute("aria-label", name);
    if (controls) {
      el.setAttribute("aria-controls", controls);
      el.setAttribute("aria-expanded", "false");
    }
  }
  const scene = document.querySelector(".flashcard-scene");
  scene.role = "button";
  scene.tabIndex = 0;
  scene.setAttribute("aria-label", "Карточканы аудару");
  scene.setAttribute("aria-pressed", "false");
  scene.onkeydown = (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      scene.click();
    }
  };
  for (const [id, limit] of [
    ["cta", 12000],
    ["sumIn", 12000],
    ["transIn", 12000],
    ["fixIn", 12000],
    ["planTopic", 8000],
    ["planGoal", 2000],
    ["quizTopic", 8000],
    ["fcGenTopic", 8000],
  ]) {
    const el = $(id);
    if (!el) continue;
    el.maxLength = limit;
    const count = document.createElement("small");
    count.className = "input-count";
    count.id = id + "Limit";
    count.textContent = `0 / ${limit}`;
    el.after(count);
    el.setAttribute("aria-describedby", count.id);
    el.addEventListener(
      "input",
      () => (count.textContent = `${el.value.length} / ${limit}`),
    );
  }
  const stop = button("Тоқтату", stopChat);
  styleAction(stop, { name: "stop", tone: "danger" });
  stop.id = "chatStop";
  stop.hidden = true;
  $("sndbtn").after(stop);
  const save = document.createElement("small");
  save.id = "chatSaveStatus";
  save.role = "status";
  $("cta").parentElement.after(save);
  const quota = document.createElement("div");
  quota.id = "quotaStatus";
  quota.className = "quota-summary";
  quota.role = "status";
  quota.hidden = true;
  $("unav").after(quota);
  const mobileQuota = quota.cloneNode(false);
  mobileQuota.id = "chatQuotaStatus";
  mobileQuota.classList.add("quota-summary--mobile");
  document.querySelector(".ctop").append(mobileQuota);
  const quotaViews = [quota, mobileQuota];
  for (const page of ["tools", "planner", "flashcard", "quiz"]) {
    const view = mobileQuota.cloneNode(false);
    view.id = page + "QuotaStatus";
    $("pg-" + page)
      .querySelector(".cont")
      .prepend(view);
    quotaViews.push(view);
  }
  onSessionReset(() => {
    for (const node of quotaViews) {
      node.replaceChildren();
      node.hidden = true;
      node.removeAttribute("aria-label");
    }
  });
  document.addEventListener("smart-helper:quota", ({ detail }) => {
    const remaining = detail?.remaining;
    if (
      !remaining ||
      ![remaining.day, remaining.minute].every(
        (n) => Number.isInteger(n) && n >= 0,
      )
    )
      return;
    for (const node of quotaViews) {
      node.replaceChildren();
      node.setAttribute(
        "aria-label",
        `Қалған AI сұраулары: бүгін ${remaining.day}, осы минутта ${remaining.minute}`,
      );
      for (const [label, value] of [
        ["Бүгін қалды", remaining.day],
        ["Осы минутта", remaining.minute],
      ]) {
        const stat = document.createElement("span"),
          caption = document.createElement("span"),
          number = document.createElement("strong"),
          unit = document.createElement("span");
        stat.className = "quota-summary__stat";
        stat.dataset.empty = String(value === 0);
        caption.className = "quota-summary__label";
        caption.textContent = label + ": ";
        number.className = "quota-summary__value";
        number.textContent = String(value);
        unit.className = "quota-summary__unit";
        unit.textContent = " сұрау";
        stat.append(caption, number, unit);
        if (node.childNodes.length) node.append(" ");
        node.append(stat);
      }
      node.hidden = false;
    }
  });
  $("hlist").after(button("Келесі 20 чат", loadHistory));
  const profile = document.createElement("div");
  profile.className = "data-controls";
  $("pg-stats").querySelector(".cont").append(profile);

  profile.append(
    button("Деректерді экспорттау", async () => {
      const scope = captureSession();
      const data = await requestAccount("export", scope);
      scope.assert();
      const local = {};
      for (const key of safeStorage.keys())
        if (key.includes(scope.userId)) local[key] = safeStorage.getItem(key);
      download("smart-helper-data.json", { cloud: data, device: local });
    }),
    button("Осы құрылғыдағы көшірмелерді тазалау", () => {
      const uid = captureSession().userId;
      if (
        !confirm(
          "Бұл құрылғыдағы сақталмаған деректер де жойылады. Алдымен экспорттаңыз. Жалғастыру керек пе?",
        )
      )
        return;
      for (const key of safeStorage.keys())
        if (key.includes(uid)) safeStorage.removeItem(key);
      status("Құрылғы көшірмелері тазаланды");
    }),
    button("Аккаунтты біржола жою", async () => {
      const scope = captureSession(),
        userId = scope.userId;
      if (
        prompt(
          "Аккаунт пен барлық бұлт деректері біржола жойылады. DELETE деп жазыңыз:",
        ) !== "DELETE"
      )
        return;
      scope.assert();
      await requestAccount("delete", scope);
      for (const key of safeStorage.keys())
        if (key.includes(userId)) safeStorage.removeItem(key);
      if (scope.valid()) {
        await getClient().auth.signOut({ scope: "local" });
        status("Аккаунт жойылды");
      }
    }),
  );
  for (const [selectId, kind, module, cancel] of [
    ["quizSavedSelect", "quiz", "quiz", "cancelQuiz"],
    ["fcSavedSelect", "flashcards", "flashcards", "cancelFlashcards"],
    ["planSavedSelect", "planner", "planner", "cancelPlanner"],
  ]) {
    const select = $(selectId),
      area = document.createElement("div");
    area.className = "library-actions";
    select.after(area);
    let offset = 0;
    onSessionReset(() => {
      offset = 0;
    });
    const search = document.createElement("input");
    search.type = "search";
    search.className = "pf-input";
    search.placeholder = "Материал іздеу";
    search.setAttribute("aria-label", "Материал атауын іздеу");
    let timer;
    search.oninput = () => {
      clearTimeout(timer);
      offset = 0;
      timer = setTimeout(
        () =>
          import("../modules/library.js")
            .then((m) => m.fillMaterialSelect(selectId, kind, 0, search.value))
            .catch((error) => status(error.message)),
        300,
      );
    };
    area.append(
      button("Қалта / белгілер", async () => {
        const folder = prompt("Қалта атауы (бос қалдыруға болады):");
        if (folder === null) return;
        const tags = prompt("Белгілер, үтір арқылы:");
        if (tags !== null)
          await (
            await import("../modules/library.js")
          ).organizeMaterial(selectId, folder, tags);
      }),
      search,
      button("Алдыңғы бет", () => {
        offset = Math.max(0, offset - 30);
        return import("../modules/library.js").then((m) =>
          m.fillMaterialSelect(selectId, kind, offset, search.value),
        );
      }),
      button("Келесі бет", () => {
        offset += 30;
        return import("../modules/library.js").then((m) =>
          m.fillMaterialSelect(selectId, kind, offset, search.value),
        );
      }),
      button("Атауын өзгерту", async () => {
        const title = prompt("Жаңа атау");
        if (title)
          await (
            await import("../modules/library.js")
          ).renameMaterial(selectId, title);
      }),
      button("Жою", async () => {
        if (confirm("Материалды біржола жою керек пе?"))
          await (
            await import("../modules/library.js")
          ).deleteMaterial(selectId);
      }),
      button("JSON экспорт", async () => {
        const saved = await (
          await import("../modules/library.js")
        ).readSelectedMaterial(selectId);
        if (saved) download("study-material.json", saved);
      }),
      button("Оқушыға тапсырма", async () => {
        const saved = await (
          await import("../modules/library.js")
        ).readSelectedMaterial(selectId);
        if (!saved) return;
        const items = saved.questions || saved.cards || saved.days;
        download(
          "study-student.txt",
          items
            .map(
              (item, i) =>
                `${i + 1}. ${item.q || item.title}\n${item.opts?.map((o, j) => `${"ABCD"[j]}. ${o}`).join("\n") || item.tasks || ""}`,
            )
            .join("\n\n"),
          "text/plain",
        );
      }),
      button("Жауаптар кілті", async () => {
        const saved = await (
          await import("../modules/library.js")
        ).readSelectedMaterial(selectId);
        if (saved)
          download(
            "study-answers.txt",
            (saved.questions || saved.cards || [])
              .map(
                (item, i) =>
                  `${i + 1}. ${item.opts?.[item.correct] || item.a}\n${item.explanation || ""}`,
              )
              .join("\n\n"),
            "text/plain",
          );
      }),
      button("Басып шығару", () => window.print()),
    );
    const page = select.closest(".page");
    arrangeMaterialLibrary({ select, area, kind, getOffset: () => offset });
    const [trigger, progress] = {
      quiz: ["quizGenBtn", "quizGenStatus"],
      flashcards: ["fcGenBtn", "fcGenStatus"],
      planner: ["planBtn", "planStatus"],
    }[kind];
    attachStopAction(
      page,
      button("Тоқтату", async () => {
        await (await cancelModules[module]())[cancel]();
        status("Тоқтатылды. Сақталған бөліктерді жалғастыруға болады.");
      }),
      $(trigger),
      $(progress),
    );
  }
  for (const el of document.querySelectorAll("[data-action=run-tool]")) {
    const stop = styleAction(
      button("Тоқтату", async () => {
        (await import("../modules/tools.js")).cancelTools();
        status("Тоқтатылды");
      }),
      { name: "stop", tone: "danger" },
    );
    el.after(stop);
    const update = () => {
      stop.hidden = !el.disabled || Boolean(el.dataset.retryAt);
    };
    new MutationObserver(update).observe(el, {
      attributes: true,
      attributeFilter: ["disabled", "data-retry-at"],
    });
    update();
  }
  // Optional generation specification shared by the three study tools.
  const { options, actions: optionActions } = createStudyOptions();
  document.body.append(options);
  const variant = document.createElement("input");
  variant.type = "hidden";
  variant.id = "studyVariant";
  options.append(variant);
  optionActions.append(
    styleAction(
      button("Жаңа нұсқа", () => {
        variant.value = crypto.randomUUID();
        status("Жаңа нұсқа таңдалды. «Жасау» басыңыз.");
      }),
      { name: "refresh", tone: "quiet" },
    ),
  );
  ensureStudyHeading($("pg-quiz")).prepend(
    styleAction(
      button("Жаңа тест", async () => {
        (await import("../modules/quiz.js")).resetQuiz();
      }),
      { name: "plus" },
    ),
  );
  const start = document.createElement("input");
  start.id = "planStart";
  start.type = "date";
  start.className = "pf-input";
  start.setAttribute("aria-label", "Жоспар басталатын күн");
  start.value = new Date().toLocaleDateString("en-CA");
  const startLabel = document.createElement("label");
  startLabel.htmlFor = start.id;
  startLabel.className = "pf-label";
  startLabel.textContent = "Басталу күні";
  $("planBtn").before(startLabel, start);
  document.addEventListener(
    "click",
    (event) => {
      const control = event.target.closest("[data-action]");
      if (
        control &&
        [
          "run-planner",
          "generate-quiz",
          "generate-flashcards",
          "run-tool",
        ].includes(control.dataset.action)
      ) {
        const inputs =
          control
            .closest(".tool-card,.planner-form,.fc-gen-area")
            ?.querySelectorAll("input,textarea,select") || [];
        for (const input of [
          ...inputs,
          ...document.querySelectorAll(
            ".study-options input,.study-options select",
          ),
        ])
          if (!input.reportValidity()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
          }
      }
    },
    true,
  );
  const reconnect = button("Қайта қосылу", initSupabase);
  reconnect.id = "authReconnect";
  reconnect.hidden = true;
  $("fL").append(reconnect);
  for (const [id, action, buttonId] of [
    ["fL", "login", "lBtn"],
    ["fR", "register", "rBtn"],
  ]) {
    const old = $(id),
      form = document.createElement("form");
    for (const attr of old.attributes) form.setAttribute(attr.name, attr.value);
    while (old.firstChild) form.append(old.firstChild);
    old.replaceWith(form);
    form.querySelectorAll("input").forEach((el) => (el.required = true));
    $(buttonId).type = "submit";
    $(buttonId).removeAttribute("data-action");
    form.onsubmit = (event) => {
      event.preventDefault();
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.action = action;
      form.append(control);
      control.click();
      control.remove();
    };
  }
  const jobs = button("Жалғастыру", async () => {
    const scope = captureSession(),
      page = document.querySelector(".page.on")?.id,
      task = {
        "pg-quiz": "quiz",
        "pg-planner": "planner",
        "pg-flashcard": "flashcards",
      }[page];
    if (!task) return;
    let saved = JSON.parse(
      safeStorage.getItem(`sh-job:${scope.userId}:${task}`) || "null",
    );
    if (!saved) {
      const { data, error } = await getClient()
        .from("ai_jobs")
        .select("id,task,params")
        .eq("user_id", scope.userId)
        .eq("task", task)
        .neq("status", "complete")
        .order("updated_at", { ascending: false })
        .limit(1);
      scope.assert();
      if (error) throw error;
      if (data?.[0]) saved = { id: data[0].id, task, payload: data[0].params };
    }
    if (!saved) {
      status("Аяқталмаған тапсырма жоқ");
      return;
    }
    const ids =
      task === "quiz"
        ? { topic: "quizTopic", count: "quizCount" }
        : task === "planner"
          ? {
              topic: "planTopic",
              goal: "planGoal",
              days: "planDays",
              hours: "planHours",
            }
          : { topic: "fcGenTopic" };
    for (const [key, id] of Object.entries(ids))
      if (saved.payload[key] !== undefined) $(id).value = saved.payload[key];
    for (const [key, id] of [
      ["difficulty", "studyDifficulty"],
      ["language", "studyLanguage"],
      ["variant", "studyVariant"],
    ])
      if (saved.payload[key] !== undefined) $(id).value = saved.payload[key];
    document.dispatchEvent(
      new CustomEvent("smart-helper:resume-job", { detail: saved }),
    );
  });
  jobs.setAttribute("aria-label", "Аяқталмаған тапсырманы жалғастыру");
  jobs.title = "Аяқталмаған тапсырманы жалғастыру";
  optionActions.append(styleAction(jobs, { name: "resume" }));
  const viewport = window.visualViewport;
  const resize = () =>
    document.documentElement.style.setProperty(
      "--app-height",
      `${viewport?.height || innerHeight}px`,
    );
  viewport?.addEventListener("resize", resize);
  resize();
  if (
    !globalThis.ReadableStream ||
    !globalThis.AbortController ||
    !globalThis.crypto?.randomUUID
  )
    status(
      "Браузерді жаңартыңыз: қазіргі Chrome, Edge, Firefox немесе Safari қажет.",
    );
}
