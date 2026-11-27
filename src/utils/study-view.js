import { renderRichText, hasMath, onMathReady } from "./rich-text.js";
export function studyText(element, text) {
  element.innerHTML = renderRichText(String(text || ""));
  if (hasMath(text))
    onMathReady(() => {
      if (element.isConnected) element.innerHTML = renderRichText(text);
    });
}
export function restoreStudyOptions(content, { restoreDifficulty = true } = {}) {
  for (const [key, id] of [
    ["difficulty", "studyDifficulty"],
    ["language", "studyLanguage"],
  ]) {
    if (key === "difficulty" && !restoreDifficulty) continue;
    const element = document.getElementById(id);
    if (element && content.specification?.[key] !== undefined)
      element.value = content.specification[key] ?? "";
  }
}
