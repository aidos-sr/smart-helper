import { withDeadline } from "./deadline.js";

export function authErrorMessage(error) {
  return (
    {
      invalid_credentials: "Email немесе құпия сөз қате.",
      email_not_confirmed:
        "Алдымен email адресіңізді растаңыз. Поштадағы сілтемені ашыңыз.",
      user_already_exists:
        "Бұл email тіркелген. Кіріңіз немесе құпия сөзді қалпына келтіріңіз.",
      weak_password:
        "Құпия сөз кемінде 8 таңбадан тұруы керек. Күрделірек құпия сөз таңдаңыз.",
      validation_failed: "Email адресінің дұрыс жазылғанын тексеріңіз.",
      email_address_invalid: "Email адресінің дұрыс жазылғанын тексеріңіз.",
      email_address_not_authorized:
        "Пошта қызметі бұл адреске хат жібере алмады. Сайт әкімшісіне хабарласыңыз.",
      over_email_send_rate_limit:
        "Пошта қызметінің хат жіберу лимиті аяқталды. Қайта-қайта баспай, кейінірек көріңіз.",
      over_request_rate_limit:
        "Сұраулар тым жиі жіберілді. Біраз күтіп, қайталаңыз.",
      email_cooldown:
        "Хат қайта жіберілген жоқ. Поштаны және «Спам» қалтасын тексеріңіз немесе таймердің аяқталуын күтіңіз.",
      auth_busy: "Сұрау орындалуда. Жауабын күтіңіз.",
      mail_delivery_unknown:
        "Сұраудың аяқталғаны расталмады. Қайта жібермес бұрын поштаңызды тексеріңіз.",
      provider_disabled:
        "Google арқылы кіру әзірге қолжетімсіз. Email арқылы кіріңіз.",
      otp_expired:
        "Сілтеменің мерзімі аяқталған немесе ол қолданылған. Жаңа сілтеме сұратыңыз.",
      access_denied:
        "Кіру аяқталмады. Қайта көріңіз немесе email арқылы кіріңіз.",
      bad_oauth_state:
        "Google арқылы кіру аяқталмады. Осы браузерде қайта көріңіз.",
    }[error?.code] ||
    (error?.name === "TimeoutError"
      ? "Байланыс уақыты аяқталды. Интернетті тексеріп, қайта көріңіз."
      : "Әрекет орындалмады. Кейінірек қайталаңыз.")
  );
}

export function createAuthActions({
  getClient,
  initialize,
  storage,
  projectKey = "default",
  origin,
  getAvailability = async () => ({ google: null }),
  getMailRetryAfter = () => 0,
  getAuthOrigin = () => null,
  navigate = () => {},
  now = Date.now,
  onMailState = () => {},
  requestTimeoutMs = 20000,
}) {
  const cooldownKey = "sh-auth-mail-until:" + projectKey;
  let mailBusy = false,
    loginBusy = false,
    googleBusy = false;
  const failure = (code) => Object.assign(new Error(code), { code });
  const mailState = () => ({
    busy: mailBusy,
    until: Number(storage.getItem(cooldownKey) || 0),
    seconds: Math.max(
      0,
      Math.ceil((Number(storage.getItem(cooldownKey) || 0) - now()) / 1000),
    ),
  });
  const hold = (seconds) => {
    storage.setItem(cooldownKey, String(now() + seconds * 1000));
  };
  async function client() {
    if (!getClient()) await initialize();
    return getClient();
  }
  async function sendMail(action, payload) {
    if (mailBusy) throw failure("auth_busy");
    if (mailState().seconds > 0) throw failure("email_cooldown");
    mailBusy = true;
    onMailState(mailState());
    try {
      const auth = (await client()).auth;
      const result = await withDeadline(
        () =>
          action === "signup"
            ? auth.signUp({
                ...payload,
                options: {
                  ...payload.options,
                  emailRedirectTo: origin() + "/",
                },
              })
            : action === "resend"
              ? auth.resend({
                  type: "signup",
                  email: payload.email,
                  options: { emailRedirectTo: origin() + "/" },
                })
              : auth.resetPasswordForEmail(payload.email, {
                  redirectTo: origin() + "/",
                }),
        { timeoutMs: requestTimeoutMs },
      );
      if (result.error) throw result.error;
      hold(60);
      return result.data;
    } catch (error) {
      if (
        error?.status === 429 ||
        ["over_email_send_rate_limit", "over_request_rate_limit"].includes(
          error?.code,
        )
      ) {
        const hint =
          Number(error.retryAfter) ||
          getMailRetryAfter() ||
          Number(error.message?.match(/after\s+(\d+)\s+seconds/i)?.[1]) ||
          60;
        hold(Math.min(3600, Math.max(1, hint)));
      } else if (
        error?.status >= 500 ||
        [
          "TimeoutError",
          "AbortError",
          "AuthRetryableFetchError",
          "TypeError",
        ].includes(error?.name)
      ) {
        hold(60);
        throw failure("mail_delivery_unknown");
      }
      throw error;
    } finally {
      mailBusy = false;
      onMailState(mailState());
    }
  }
  return {
    mailState,
    register: (payload) => sendMail("signup", payload),
    resetPassword: (email) => sendMail("recover", { email }),
    resendConfirmation: (email) => sendMail("resend", { email }),
    async login(payload) {
      if (loginBusy) throw failure("auth_busy");
      loginBusy = true;
      try {
        const auth = (await client()).auth;
        const { data, error } = await withDeadline(
          () => auth.signInWithPassword(payload),
          { timeoutMs: requestTimeoutMs },
        );
        if (error) throw error;
        return data;
      } finally {
        loginBusy = false;
      }
    },
    async google() {
      if (googleBusy) throw failure("auth_busy");
      googleBusy = true;
      try {
        const auth = (await client()).auth;
        if ((await getAvailability()).google === false)
          throw failure("provider_disabled");
        const { data, error } = await withDeadline(
          () =>
            auth.signInWithOAuth({
              provider: "google",
              options: {
                redirectTo: origin() + "/",
                skipBrowserRedirect: true,
                queryParams: { prompt: "select_account" },
              },
            }),
          { timeoutMs: Math.min(15000, requestTimeoutMs) },
        );
        if (error) throw error;
        const target = new URL(data.url);
        if (
          target.protocol !== "https:" ||
          (getAuthOrigin() && target.origin !== getAuthOrigin())
        )
          throw failure("access_denied");
        navigate(target.href);
        return data;
      } finally {
        googleBusy = false;
      }
    },
  };
}
