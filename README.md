# Smart Helper

Прямое подключение Gemini из Google AI Studio: [GEMINI-SETUP.md](docs/GEMINI-SETUP.md). Выбор задаётся серверной переменной `AI_PROVIDER`; по умолчанию остаётся OpenRouter. Для Gemini нужен `GEMINI_API_KEY`, ключ OpenRouter в этом режиме не требуется.

AI-помощник для учёбы на казахском и русском языках. Чат с потоковыми ответами принимает фото, PDF и текстовые файлы; планы, карточки и тесты создаются через OpenRouter. Быстрые запросы используют бесплатные модели, а сильный режим доступен только пользователям из серверного списка допуска. Он выключен по умолчанию.

Исправления обрывов, контекста, валидации и инструкция установки: [AI-RELIABILITY.md](docs/AI-RELIABILITY.md). Проверки: `npm test` и `npm run build`. Внедрение аудита: [AUDIT-IMPLEMENTATION.md](docs/AUDIT-IMPLEMENTATION.md). Перед публикацией новой версии обязательна третья SQL-миграция.

## Архитектура

```text
Браузер ── Supabase Auth + Postgres (RLS)
   │
   └── /api/chat (Vercel Function) ── OpenRouter ── fast/deep + fallback
              │
              ├── Wikipedia, arXiv и OpenAlex (учебные источники)
              │
              ├── OpenRouter Web Search (по желанию, для глубоких ответов)
              └── Supabase RPC: атомарные лимиты запросов
```

Публичный ключ Supabase передаётся браузеру через `/api/config`. Секретные ключи Supabase и OpenRouter читаются только серверной функцией.

Frontend собирается Vite и разделён на независимые модули:

```text
src/
├── main.js                 # запуск приложения, auth и чат
├── services/
│   ├── supabase.js         # клиент, сессия и обновление токена
│   └── ai.js               # запросы к серверному AI API
├── modules/
│   ├── progress.js
│   ├── library.js          # сохранённые планы, карточки и тесты
│   ├── tools.js
│   ├── planner.js
│   ├── flashcards.js
│   └── quiz.js
├── styles/
│   ├── base.css
│   ├── components.css
│   ├── pages.css
│   └── responsive.css
├── ui/background.js
└── utils/text.js

api/
├── chat.js                 # маршрутизация AI-моделей, поток и интернет-поиск
└── sources.js              # поиск публикаций arXiv и OpenAlex
```

## Настройка Supabase

1. Создайте проект на [supabase.com](https://supabase.com/dashboard).
2. Откройте **SQL Editor** и по порядку выполните:
   - [`supabase/migrations/202608060001_initial.sql`](supabase/migrations/202608060001_initial.sql);
   - [`supabase/migrations/202608060002_study_materials.sql`](supabase/migrations/202608060002_study_materials.sql);
   - [`supabase/migrations/202611250001_audit_hardening.sql`](supabase/migrations/202611250001_audit_hardening.sql).
3. В **Project Settings → API Keys** скопируйте:
   - Project URL;
   - Publishable key (`sb_publishable_…`) для браузера;
   - Secret key (`sb_secret_…`) для сервера.
4. В **Authentication → URL Configuration** задайте адрес сайта как Site URL и добавьте Vercel preview/production URL в Redirect URLs.
5. Для входа Google включите провайдер в **Authentication → Providers → Google** и добавьте показанный Supabase callback URL в Google Cloud Console.

Миграции создают таблицы `chats`, `progress`, `study_materials`, `ai_usage`, включают RLS и разрешают пользователю видеть и менять только собственные данные. `ai_usage` доступна только серверной роли.

## Переменные окружения Vercel

Добавьте значения из `.env.example` в **Vercel → Project → Settings → Environment Variables**:

| Name | Обязательно | Значение |
|---|---:|---|
| `SUPABASE_URL` | Да | Project URL из Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Да | Публичный `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | Да | Серверный `sb_secret_…` |
| `OPENROUTER_API_KEY` | Да | Секретный ключ OpenRouter |
| `OPENROUTER_UTILITY_MODEL` | Нет | Быстрая модель инструментов и учебных материалов; по умолчанию Gemma 4 26B free |
| `OPENROUTER_UTILITY_FALLBACK_MODEL` | Нет | Резерв учебных материалов другого провайдера; по умолчанию Ling 3.2 Flash free |
| `OPENROUTER_FAST_MODEL` | Нет | Быстрая бесплатная модель для обычного чата |
| `OPENROUTER_FAST_FALLBACK_MODEL` | Нет | Запасная модель обычного чата |
| `OPENROUTER_FAST_LAST_RESORT_MODEL` | Нет | Последний бесплатный резерв обычного чата |
| `OPENROUTER_DEEP_MODEL` | Нет | Модель режима «Глубокий ответ» |
| `OPENROUTER_DEEP_FALLBACK_MODEL` | Нет | Запасная модель глубокого режима |
| `OPENROUTER_DEEP_LAST_RESORT_MODEL` | Нет | Последний резерв глубокого режима |
| `OPENROUTER_STRUCTURED_MODEL` | Нет | Модель планов, карточек и тестов |
| `OPENROUTER_STRUCTURED_FALLBACK_MODEL` | Нет | Запасная модель структурированных ответов |
| `OPENROUTER_STRUCTURED_LAST_RESORT_MODEL` | Нет | Последний резерв структурированных ответов |
| `OPENROUTER_VISION_MODEL` | Нет | Бесплатная мультимодальная модель для фото |
| `OPENROUTER_VISION_FALLBACK_MODEL` | Нет | Запасной бесплатный мультимодальный маршрутизатор |
| `PUBLIC_SITE_URL` | Нет | Адрес сайта на Vercel |
| `AI_MINUTE_LIMIT` | Нет | По умолчанию 10 запросов в минуту |
| `AI_DAILY_LIMIT` | Нет | По умолчанию 50 запросов в день |
| `OPENALEX_API_KEY` | Нет | Повышает лимит научного поиска OpenAlex; arXiv доступен без него |

Режим «Терең жауап» включается оператором через `AI_PAID_ENABLED` и `AI_PAID_USER_IDS` и может расходовать баланс OpenRouter: Gemini 3.8 Flash тарифицируется провайдером за токены. Если включён и поиск в интернете, поиск тоже может тарифицироваться. Обычный режим использует бесплатные модели. Код понимает старые имена `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY`, но для новых проектов рекомендуются publishable/secret keys.

После изменения переменных создайте новый deployment. Не отправляйте `SUPABASE_SECRET_KEY` и `OPENROUTER_API_KEY` в чат и не добавляйте их в Git.

## Локальный запуск

Нужен Node.js 24+:

```bash
npm install
npm run dev
```

Для проверки production-сборки используйте `npm run build` и `npm run preview`. Полный локальный запуск вместе с Vercel Functions выполняется через `npx vercel dev`.

Для локального `.env` скопируйте `.env.example`, замените значения и сохраните файл как `.env`; он исключён из Git.

## Что хранится в Supabase

- Supabase Auth: email/password и Google OAuth.
- `chats`: история с загрузкой метаданных по 20 диалогов; сообщения читаются при выборе.
- `progress`: статистика и XP.
- `study_materials`: сохранённые планы, карточки и тесты.
- `ai_usage`: минутные и дневные лимиты AI, изменяемые только сервером.
- `ai_control`, `ai_jobs`, `ai_model_health`: общие ограничения, аренды заданий, контрольные точки и состояние моделей.
- `progress_events`: уникальные события прогресса; изменения выполняются атомарной RPC.

Все пользовательские таблицы защищены Row Level Security. Сервер дополнительно проверяет актуального пользователя через `auth.getUser(access_token)` перед обращением к модели.

## Ограничения и безопасность

- Входные данные, длина истории и параметры AI-инструментов ограничены.
- Вложения отправляются в AI напрямую и не сохраняются в Supabase; поддерживаются JPEG, PNG, WebP, PDF, TXT, MD и CSV.
- Planner, flashcard и quiz используют совместимый JSON-режим со схемой в инструкции и обязательной серверной валидацией; при несовместимости формата меняется только способ запроса, валидация сохраняется.
- При ошибке без результата возвращается дневная учебная квота. Минутный счётчик и общий счётчик попыток сохраняются.
- Поиск в интернете использует открытый MediaWiki API, arXiv и OpenAlex. В режиме глубокого ответа модель также может искать актуальные страницы в интернете и приводить ссылки.
- Для контроля расходов задайте spending limit в OpenRouter.
- JavaScript вынесен в ES-модули, поэтому `unsafe-inline` удалён из `script-src` CSP.
- В CSS ещё используются отдельные inline-стили разметки, поэтому `style-src` временно сохраняет `unsafe-inline`.

## Надёжность учебных модулей

Инструменты, планы, карточки и тесты используют потоковый API с реальным прогрессом и общим ограничением времени. Длинные планы собираются блоками по 5 дней, тесты — по 5 вопросов без повторов. Все внутренние блоки используют одну пользовательскую квоту. Обычный чат сохраняет свой бюджет 52 секунды; учебным заданиям отведено до 165 секунд при максимуме Vercel Function 180 секунд.

Сгенерированный материал становится доступен сразу. Сохранение в Supabase выполняется отдельно с таймаутом 8 секунд; при сбое копия остаётся на текущем устройстве под идентификатором пользователя. Повторное открытие материалов сначала использует локальную копию, затем пытается получить данные из облака. Пароли и API-ключи в этот кэш не записываются.
