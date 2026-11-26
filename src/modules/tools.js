import { captureSession, onSessionReset } from "../../lib/session-scope.js";
const controllers = new Map();
export function cancelTools() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
}
onSessionReset(cancelTools);
import { requestAI, studyProgressText } from "../services/ai.js";

export async function runTool(type, btn) {
  const configs = {
    sum: { inId: "sumIn", outId: "sumOut" },
    trans: { inId: "transIn", outId: "transOut" },
    fix: { inId: "fixIn", outId: "fixOut" },
  };
  const cfg = configs[type];
  if (!cfg) return;
  const inp = document.getElementById(cfg.inId).value.trim();
  const out = document.getElementById(cfg.outId);
  if (!inp) {
    out.textContent = "Мәтін енгізіңіз";
    out.classList.add("show");
    return;
  }
  if (btn?.disabled) return;
  const scope = captureSession(),
    controller = new AbortController();
  controllers.set(type, controller);
  const original = btn?.innerHTML;
  if (btn) btn.disabled = true;
  out.className = "tc-result show";
  out.innerHTML = '<span class="tloading">Өңделуде...</span>';
  try {
    const payload = { input: inp };
    if (type === "trans")
      payload.targetLanguage = document.getElementById("transLang").value;
    const response = await requestAI(type, payload, {
      signal: controller.signal,
      onProgress: (event) => {
        out.textContent = studyProgressText(event);
      },
    });
    scope.assert();
    out.textContent = response.text || "Жауап алынбады";
  } catch (error) {
    if (!scope.valid()) return;
    if (controller.signal.aborted) {
      out.textContent = "Тоқтатылды.";
      return;
    }
    out.textContent = error.message || "Қате орын алды.";
  } finally {
    controllers.delete(type);
    if (btn && scope.valid()) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}
