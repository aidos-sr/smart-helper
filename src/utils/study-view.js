import { renderRichText, hasMath, onMathReady } from "./rich-text.js";
export function studyText(element, text) {
  element.innerHTML = renderRichText(String(text || ""));
  if (hasMath(text))
    onMathReady(() => {
      if (element.isConnected) element.innerHTML = renderRichText(text);
    });
}
export function restoreStudyOptions(content) {
  for (const [key, id] of [
    ["grade", "studyGrade"],
    ["difficulty", "studyDifficulty"],
    ["language", "studyLanguage"],
  ]) {
    const element = document.getElementById(id);
    if (element && content.specification?.[key] !== undefined)
      element.value = content.specification[key] ?? "";
  }
}
