import { onSessionReset } from "../../lib/session-scope.js";
const paths = {
  book: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4z M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  print:
    "M6 9V3h12v6 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z M18 12h.01",
  key: "M8 15a6 6 0 1 1 5-5L4 19H1v-3l4-4 M15 6h.01",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  chevron: "m9 5 7 7-7 7",
  edit: "m16 3 5 5-12 12-6 1 1-6z M13 6l5 5",
  folder:
    "M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  search: "M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  plus: "M12 5v14 M5 12h14",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18a8 8 0 0 1-13-2",
  resume: "M3 11a9 9 0 1 1 2 7 M3 5v6h6 m2-3 5 4-5 4z",
  stop: "M6 6h12v12H6z",
  info: "M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
};
export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", name === "more" ? "3" : "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name] || paths.file);
  svg.append(path);
  return svg;
}
export function styleAction(element, { name, tone = "secondary", label } = {}) {
  const text = label || element.textContent.trim();
  element.className = `sh-button sh-button--${tone}`;
  element.replaceChildren();
  if (name) element.append(icon(name));
  const span = document.createElement("span");
  span.textContent = text;
  element.append(span);
  return element;
}
export function ensureStudyHeading(page) {
  let header = page.querySelector(".study-page-heading");
  if (header) return header.querySelector(".study-heading-actions");
  const title = page.querySelector(".st");
  header = document.createElement("div");
  header.className = "study-page-heading";
  const actions = document.createElement("div");
  actions.className = "study-heading-actions";
  title.replaceWith(header);
  header.append(title, actions);
  return actions;
}
export function attachStopAction(page, stop, trigger, statusElement) {
  styleAction(stop, {
    name: "stop",
    tone: "danger",
    label: "Тоқтату",
  });
  stop.classList.add("study-stop-action");
  ensureStudyHeading(page).append(stop);
  const update = () => {
    stop.hidden =
      !trigger.disabled || statusElement?.dataset.state !== "loading";
  };
  const observer = new MutationObserver(update);
  observer.observe(trigger, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  if (statusElement)
    observer.observe(statusElement, {
      attributes: true,
      attributeFilter: ["data-state"],
    });
  update();
}
export function createStudyOptions() {
  const options = document.createElement("section");
  options.className = "study-options";
  options.setAttribute("aria-label", "Оқу материалының параметрлері");
  options.hidden = true;
  const top = document.createElement("div");
  top.className = "study-options__top";
  const title = document.createElement("div");
  title.className = "study-options__title";
  title.append(
    icon("settings"),
    document.createTextNode("Материал параметрлері"),
  );
  const actions = document.createElement("div");
  actions.className = "study-options__actions";
  top.append(title, actions);
  const grid = document.createElement("div");
  grid.className = "study-options__grid";
  for (const [id, label, type, choices] of [
    ["studyGrade", "Сынып", "number"],
    [
      "studyDifficulty",
      "Күрделілік",
      "select",
      [
        ["easy", "Жеңіл"],
        ["medium", "Орташа"],
        ["hard", "Күрделі"],
      ],
    ],
    [
      "studyLanguage",
      "Тіл",
      "select",
      [
        ["kk", "Қазақша"],
        ["ru", "Русский"],
      ],
    ],
  ]) {
    const field = document.createElement("div");
    field.className = "study-field";
    const caption = document.createElement("label");
    caption.htmlFor = id;
    caption.textContent = label;
    const control = document.createElement(
      type === "select" ? "select" : "input",
    );
    control.id = id;
    if (type === "number") {
      control.type = "number";
      control.min = "1";
      control.max = "12";
      control.placeholder = "1–12";
      control.inputMode = "numeric";
    } else {
      for (const [value, text] of choices)
        control.append(new Option(text, value));
      control.value = id === "studyDifficulty" ? "medium" : "kk";
    }
    field.append(caption, control);
    grid.append(field);
  }
  const note = document.createElement("p");
  note.className = "study-options__note";
  note.append(
    icon("info"),
    document.createTextNode(
      "AI материалын сабақта қолданар алдында тексеріңіз. XP — оқу белсенділігі, баға емес.",
    ),
  );
  options.append(top, grid, note);
  return {
    options,
    actions,
  };
}
function arrangeWorkspace(page, library) {
  const content = page.querySelector(".cont");
  if (page.id === "pg-planner") {
    let output = page.querySelector(".planner-content");
    if (!output) {
      output = document.createElement("div");
      output.className = "planner-content";
      const result = page.querySelector(".planner-output");
      result.replaceWith(output);
      output.append(result);
    }
    output.prepend(library);
    return;
  }
  let workspace = page.querySelector(".study-workspace");
  if (!workspace) {
    workspace = document.createElement("div");
    workspace.className = "study-workspace";
    const main = document.createElement("div");
    main.className = "study-workspace__main";
    workspace.append(main);
    content.append(workspace);
    const roots =
      page.id === "pg-quiz"
        ? ["#quizSetup", "#quizActive", "#quizResult"]
        : [".flashcard-area"];
    for (const selector of roots) main.append(page.querySelector(selector));
    if (page.id === "pg-flashcard") {
      const generator = page.querySelector(".fc-gen-area");
      generator.classList.add("study-generator");
      main.prepend(generator);
    }
  }
  workspace.append(library);
}
export function arrangeMaterialLibrary({
  select,
  area,
  kind,
  getOffset = () => 0,
}) {
  const page = select.closest(".page");
  const actions = new Map(
    [...area.querySelectorAll("button")].map((button) => [
      button.textContent.trim(),
      button,
    ]),
  );
  const search = area.querySelector("input[type=search]");
  const titleId = select.id + "Title",
    name = {
      quiz: "Сақталған тесттер",
      planner: "Сақталған жоспарлар",
      flashcards: "Сақталған карточкалар",
    }[kind];
  area.className = "material-library";
  area.setAttribute("role", "region");
  area.setAttribute("aria-labelledby", titleId);
  const header = document.createElement("div");
  header.className = "material-library__header";
  const heading = document.createElement("h3");
  heading.id = titleId;
  heading.append(icon("book"), document.createTextNode(name));
  const count = document.createElement("span");
  count.className = "material-library__count";
  count.setAttribute("aria-label", "Осы беттегі материал саны");
  header.append(heading, count);
  const fields = document.createElement("div");
  fields.className = "material-library__fields";
  const label = document.createElement("label");
  label.htmlFor = select.id;
  label.textContent = "Материалды таңдаңыз";
  select.hidden = false;
  if (!select.options.length)
    select.append(new Option("Сақталған материалды таңдаңыз", ""));
  const searchField = document.createElement("div");
  searchField.className = "material-library__search";
  search.placeholder = "Атауы, қалта немесе белгі";
  search.setAttribute("aria-label", "Материал, қалта немесе белгі іздеу");
  searchField.append(icon("search"), search);
  fields.append(label, select, searchField);
  const primary = document.createElement("div");
  primary.className = "material-library__primary";
  primary.setAttribute("role", "group");
  primary.setAttribute("aria-label", "Материалмен жұмыс");
  const student = styleAction(actions.get("Оқушыға тапсырма"), {
      name: "file",
      tone: "primary",
      label: "Тапсырманы алу",
    }),
    print = styleAction(actions.get("Басып шығару"), {
      name: "print",
    });
  student.dataset.libraryAction = "student";
  print.dataset.libraryAction = "print";
  primary.append(student, print);
  const secondary = document.createElement("div");
  secondary.className = "material-library__secondary";
  const answers = styleAction(actions.get("Жауаптар кілті"), {
    name: "key",
    tone: "quiet",
  });
  answers.dataset.libraryAction = "answers";
  if (kind !== "planner") secondary.append(answers);
  const more = document.createElement("details");
  more.className = "study-action-menu";
  const summary = document.createElement("summary");
  summary.className = "sh-button sh-button--quiet";
  summary.setAttribute("aria-label", "Қосымша әрекеттер");
  summary.append(icon("more"), document.createTextNode("Қосымша"));
  const menu = document.createElement("div");
  menu.className = "study-action-menu__panel";
  for (const [label, name, key, tone] of [
    ["Атауын өзгерту", "edit", "rename", "quiet"],
    ["Қалта / белгілер", "folder", "organize", "quiet"],
    ["JSON экспорт", "download", "json", "quiet"],
    ["Жою", "trash", "delete", "danger"],
  ]) {
    const action = styleAction(actions.get(label), {
      name,
      tone,
      label: key === "delete" ? "Материалды жою" : label,
    });
    action.dataset.libraryAction = key;
    action.addEventListener("click", () => {
      more.open = false;
    });
    menu.append(action);
  }
  more.append(summary, menu);
  secondary.append(more);
  const footer = document.createElement("div");
  footer.className = "material-library__footer";
  const hint = document.createElement("small");
  hint.className = "material-library__hint";
  hint.setAttribute("role", "status");
  const pagination = document.createElement("div");
  pagination.className = "material-library__pagination";
  pagination.setAttribute("role", "group");
  pagination.setAttribute("aria-label", "Материал беттері");
  const previous = styleAction(actions.get("Алдыңғы бет"), {
    name: "chevron",
    tone: "quiet",
    label: "Артқа",
  });
  previous.setAttribute("aria-label", "Материалдардың алдыңғы беті");
  previous.dataset.libraryAction = "previous";
  const next = styleAction(actions.get("Келесі бет"), {
    name: "chevron",
    tone: "quiet",
    label: "Келесі",
  });
  next.setAttribute("aria-label", "Материалдардың келесі беті");
  next.dataset.libraryAction = "next";
  pagination.append(previous, next);
  footer.append(hint, pagination);
  area.replaceChildren(header, fields, primary, secondary, footer);
  arrangeWorkspace(page, area);
  const selectionActions = [
    student,
    answers,
    ...menu.querySelectorAll("button"),
  ];
  const update = () => {
    const selected = Boolean(select.value);
    for (const action of selectionActions) action.disabled = !selected;
    const total = [...select.options].filter((option) => option.value).length;
    count.textContent = String(total);
    hint.textContent = selected
      ? "Материал таңдалды"
      : total
        ? "Алдымен материалды таңдаңыз"
        : "Сақталған материал табылмады";
    pagination.hidden = total < 30 && getOffset() === 0;
    previous.disabled = getOffset() === 0;
    next.disabled = total < 30;
  };
  select.addEventListener("change", update);
  new MutationObserver(update).observe(select, {
    childList: true,
    subtree: true,
  });
  update();
  const shortcut = document.createElement("button");
  shortcut.type = "button";
  shortcut.textContent = "Сақталғандар";
  styleAction(shortcut, {
    name: "book",
  });
  shortcut.classList.add("study-library-shortcut");
  shortcut.onclick = () => {
    area.scrollIntoView?.({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    select.focus({
      preventScroll: true,
    });
  };
  ensureStudyHeading(page).append(shortcut);
  onSessionReset(() => {
    more.open = false;
  });
}
export function installActionMenus() {
  document.addEventListener("click", (event) => {
    for (const menu of document.querySelectorAll(".study-action-menu[open]"))
      if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const menu of document.querySelectorAll(".study-action-menu[open]")) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
}
