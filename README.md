# Smart Helper

Қазақ және орыс тілдерінде жұмыс істейтін AI оқу көмекшісі. Чат, мәтін құралдары, оқу жоспары, flashcard және тест генераторы Qwen арқылы серверде орындалады.

## Архитектура

```text
Browser → /api/chat (Vercel Function) → OpenRouter → qwen/qwen3.5-9b
                       ↓
                 Firebase Auth + Realtime Database rate limits
```

API кілттері браузерге жіберілмейді. Әр сұрауда Firebase ID token тексеріледі. Сервер минуттық және күндік лимитті Firebase транзакциясымен атомарлы есептейді.

## Қажетті баптаулар

1. OpenRouter-ден API key жасаңыз.
2. Firebase Console → Project settings → Service accounts → Generate new private key арқылы service account JSON жүктеңіз.
3. Vercel жобасының **Settings → Environment Variables** бөлімінде `.env.example` ішіндегі айнымалыларды қосыңыз.
4. `FIREBASE_SERVICE_ACCOUNT_JSON` мәніне service account файлының толық JSON мазмұнын салыңыз.
5. Firebase Realtime Database rules ретінде `firebase-database.rules.json` файлын қолданыңыз.
6. Environment variables өзгергеннен кейін жаңа deployment жасаңыз.

Маңызды: `.env` және service account JSON файлдарын Git-ке қоспаңыз.

## Environment variables

| Name | Міндетті | Мәні |
|---|---:|---|
| `OPENROUTER_API_KEY` | Иә | OpenRouter құпия кілті |
| `FIREBASE_DATABASE_URL` | Иә | Firebase Realtime Database URL |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Иә | Firebase Admin service account JSON |
| `OPENROUTER_MODEL` | Жоқ | Әдепкісі `qwen/qwen3.5-9b` |
| `PUBLIC_SITE_URL` | Жоқ | Vercel сайт адресі |
| `AI_MINUTE_LIMIT` | Жоқ | Әдепкісі 10 сұрау/минут |
| `AI_DAILY_LIMIT` | Жоқ | Әдепкісі 100 сұрау/күн |

## Локалды тексеру

Node.js 20+ орнатып:

```bash
npm install
npx vercel dev
```

Vercel айнымалыларын локалды ортаға жүктеу үшін `vercel env pull` қолданыңыз.

## Қауіпсіздік

- OpenRouter және Firebase Admin құпиялары тек серверде оқылады.
- API Firebase авторизациясынсыз жұмыс істемейді.
- Кіріс өлшемі, тарих ұзындығы және тапсырма параметрлері шектелген.
- Planner, flashcard және quiz нәтижелері JSON Schema арқылы тексеріледі.
- `aiUsage` жолына браузерден кіруге Firebase rules тыйым салады; оны тек Admin SDK өзгертеді.
- Қолданыс шығынын қосымша шектеу үшін OpenRouter аккаунтында spending limit орнатыңыз.

Қазіргі бір файлдық frontend inline script/style қолданады, сондықтан CSP ішінде уақытша `unsafe-inline` бар. Кодты бөлек CSS/JS модульдеріне шығарғаннан кейін оны nonce/hash негізіндегі қатаң CSP-ге ауыстыру керек.
