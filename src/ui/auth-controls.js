import { authActions, authErrorMessage } from "../services/auth.js";
import { getAuthAvailability } from "../services/supabase.js";
import { updatePassword } from "../services/account.js";
import { captureSession, onSessionReset } from "../../lib/session-scope.js";

export function installAuthControls({ onRecovered = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const login = $("fL"),
    register = $("fR"),
    google = document.querySelector('[data-action="google-login"]');
  google.id = "googleBtn";
  const divider = google.previousElementSibling;
  const providerHint = document.createElement("p");
  providerHint.id = "googleStatus";
  providerHint.className = "auth-provider-status";
  providerHint.hidden = true;
  google.after(providerHint);
  google.setAttribute("aria-describedby", providerHint.id);
  const forgot = document.createElement("button");
  forgot.type = "button";
  forgot.id = "forgotPassword";
  forgot.className = "auth-text-button";
  forgot.textContent = "Құпия сөзді ұмыттыңыз ба?";
  login.append(forgot);
  const reset = document.createElement("form");
  reset.id = "resetForm";
  reset.hidden = true;
  reset.innerHTML =
    '<h2 class="auth-view-title">Құпия сөзді қалпына келтіру</h2><p class="auth-view-description">Email адресіңізді енгізіңіз. Қалпына келтіру сілтемесін жібереміз.</p><div class="fg"><label class="fl" for="resetEmail">Email</label><input class="fi" id="resetEmail" type="email" autocomplete="email" required></div><p id="resetNotice" class="auth-notice" role="status"></p><button id="resetBtn" class="bpri fw" type="submit">Сілтеме жіберу</button><button class="auth-text-button" type="button" data-auth-back>Кіруге оралу</button>';
  const confirm = document.createElement("section");
  confirm.id = "authConfirm";
  confirm.hidden = true;
  confirm.innerHTML =
    '<h2 class="auth-view-title">Email адресіңізді растаңыз</h2><p id="confirmNotice" class="auth-notice" role="status"></p><p class="auth-view-description">Поштадағы сілтемені ашыңыз. Хат көрінбесе, «Спам» қалтасын тексеріңіз.</p><button id="authResend" class="bpri fw" type="button">Растау хатын қайта жіберу</button><button class="auth-text-button" type="button" data-auth-back>Кіруге оралу</button>';
  const recovery = document.createElement("form");
  recovery.id = "recoveryForm";
  recovery.hidden = true;
  recovery.innerHTML =
    '<h2 class="auth-view-title">Жаңа құпия сөз</h2><div class="fg"><label class="fl" for="newPassword">Құпия сөз</label><input class="fi" id="newPassword" type="password" autocomplete="new-password" minlength="8" required></div><div class="fg"><label class="fl" for="confirmPassword">Құпия сөзді қайталаңыз</label><input class="fi" id="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div><p id="recoveryNotice" class="auth-notice" role="status"></p><button class="bpri fw" type="submit">Сақтау</button>';
  const cooldown = document.createElement("p");
  cooldown.id = "authMailCooldown";
  cooldown.className = "auth-cooldown";
  cooldown.role = "status";
  cooldown.hidden = true;
  register.after(reset, confirm, recovery, cooldown);
  let pendingEmail = "",
    scope = null,
    view = "login",
    timer,
    googleEnabled = null;
  const views = { login, register, reset, confirm, recovery };
  function show(next) {
    view = next;
    for (const [id, name] of [
      ["tabL", "login"],
      ["tabR", "register"],
    ]) {
      $(id).classList.toggle("on", next === name);
      $(id).setAttribute("aria-pressed", String(next === name));
    }
    for (const [name, node] of Object.entries(views)) {
      node.style.display = "";
      node.hidden = name !== next;
    }
    const ordinary = ["login", "register"].includes(next);
    $("authTabs").hidden = !ordinary;
    google.hidden = !ordinary;
    divider.hidden = !ordinary;
    providerHint.hidden = !ordinary || googleEnabled !== false;
    refreshMailButtons();
  }
  function notice(id, text, error = false) {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle("is-error", error);
  }
  function refreshMailButtons() {
    window.clearTimeout(timer);
    const state = authActions.mailState();
    for (const id of ["rBtn", "resetBtn", "authResend"])
      $(id).disabled = state.busy || state.seconds > 0;
    const visible = ["register", "reset", "confirm"].includes(view);
    cooldown.hidden = !visible || (!state.busy && !state.seconds);
    cooldown.textContent = state.busy
      ? "Хат жіберілуде…"
      : state.seconds
        ? `Қайта жіберуге дейін: ${state.seconds} с`
        : "";
    if (state.seconds > 0) timer = window.setTimeout(refreshMailButtons, 1000);
  }
  forgot.onclick = () => {
    $("resetEmail").value = $("lE").value;
    notice("resetNotice", "");
    show("reset");
    $("resetEmail").focus();
  };
  for (const back of document.querySelectorAll("[data-auth-back]"))
    back.onclick = () => {
      $("lE").value = $("resetEmail").value || pendingEmail || $("lE").value;
      document.dispatchEvent(
        new CustomEvent("smart-helper:auth-view", { detail: "login" }),
      );
    };
  reset.onsubmit = async (event) => {
    event.preventDefault();
    if (!reset.reportValidity()) return;
    notice("resetNotice", "");
    try {
      await authActions.resetPassword($("resetEmail").value.trim());
      notice(
        "resetNotice",
        "Егер бұл email тіркелген болса, қалпына келтіру сілтемесі жіберіледі. Поштаңызды тексеріңіз.",
      );
    } catch (error) {
      notice("resetNotice", authErrorMessage(error), true);
    } finally {
      refreshMailButtons();
    }
  };
  $("authResend").onclick = async () => {
    if (!pendingEmail) return;
    try {
      await authActions.resendConfirmation(pendingEmail);
      notice(
        "confirmNotice",
        "Растау хаты қайта сұратылды. Поштаңызды тексеріңіз.",
      );
    } catch (error) {
      notice("confirmNotice", authErrorMessage(error), true);
    } finally {
      refreshMailButtons();
    }
  };
  recovery.onsubmit = async (event) => {
    event.preventDefault();
    if (!recovery.reportValidity()) return;
    notice("recoveryNotice", "");
    if ($("newPassword").value !== $("confirmPassword").value) {
      notice("recoveryNotice", "Құпия сөздер бірдей емес.", true);
      return;
    }
    const owner = scope,
      button = recovery.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await updatePassword($("newPassword").value, owner);
      owner.assert();
      $("newPassword").value = "";
      $("confirmPassword").value = "";
      recovery.hidden = true;
      onRecovered();
    } catch (error) {
      if (owner?.valid())
        notice("recoveryNotice", authErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  };
  onSessionReset(() => {
    scope = null;
    pendingEmail = "";
    $("newPassword").value = "";
    $("confirmPassword").value = "";
    $("resetEmail").value = "";
    recovery.hidden = true;
    for (const id of ["confirmNotice", "resetNotice", "recoveryNotice"])
      $(id).textContent = "";
    show("login");
  });
  document.addEventListener("smart-helper:auth-view", ({ detail }) => {
    show(detail === "register" ? "register" : "login");
  });
  document.addEventListener("smart-helper:auth-mail-state", refreshMailButtons);
  document.addEventListener("smart-helper:confirmation", ({ detail }) => {
    pendingEmail = detail.email;
    notice("confirmNotice", "Растау сілтемесі сұратылды: " + pendingEmail);
    show("confirm");
  });
  document.addEventListener("smart-helper:recovery", () => {
    scope = captureSession();
    document
      .querySelectorAll(".page,.chatwrap")
      .forEach((el) => el.classList.remove("on"));
    $("pg-auth").classList.add("on");
    document.querySelector(".nav").classList.add("hidden");
    document.body.style.overflow = "";
    show("recovery");
  });
  show("login");
  return {
    refreshMailButtons,
    async refreshAvailability(options = {}) {
      const features = await getAuthAvailability(options);
      googleEnabled = features.google;
      google.disabled = features.google === false;
      providerHint.textContent =
        features.google === false
          ? "Google арқылы кіру әзірге қолжетімсіз. Email және құпия сөзбен кіріңіз."
          : "";
      providerHint.hidden =
        !["login", "register"].includes(view) || features.google !== false;
    },
  };
}
