# Smart Helper

AI-помощник для учёбы на казахском и русском языках. Чат, обработка текста, учебные планы, карточки и тесты работают через размещённую модель Qwen — локальный запуск модели не нужен.

## Архитектура

```text
Браузер ── Supabase Auth + Postgres (RLS)
   │
   └── /api/chat (Vercel Function) ── OpenRouter ── openrouter/free
              │
              └── Supabase RPC: атомарные лимиты запросов
```

Публичный ключ Supabase передаётся браузеру через `/api/config`. Секретные ключи Supabase и OpenRouter читаются только серверной функцией.

## Настройка Supabase

1. Создайте проект на [supabase.com](https://supabase.com/dashboard).
2. Откройте **SQL Editor**, вставьте содержимое [`supabase/migrations/202608060001_initial.sql`](supabase/migrations/202608060001_initial.sql) и выполните запрос.
3. В **Project Settings → API Keys** скопируйте:
   - Project URL;
   - Publishable key (`sb_publishable_…`) для браузера;
   - Secret key (`sb_secret_…`) для сервера.
4. В **Authentication → URL Configuration** задайте адрес сайта как Site URL и добавьте Vercel preview/production URL в Redirect URLs.
5. Для входа Google включите провайдер в **Authentication → Providers → Google** и добавьте показанный Supabase callback URL в Google Cloud Console.

SQL-миграция создаёт таблицы `chats`, `progress`, `ai_usage`, включает RLS и разрешает пользователю видеть и менять только собственные чаты и прогресс. `ai_usage` доступна только серверной роли.

## Переменные окружения Vercel

Добавьте значения из `.env.example` в **Vercel → Project → Settings → Environment Variables**:

| Name | Обязательно | Значение |
|---|---:|---|
| `SUPABASE_URL` | Да | Project URL из Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Да | Публичный `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | Да | Серверный `sb_secret_…` |
| `OPENROUTER_API_KEY` | Да | Секретный ключ OpenRouter |
| `OPENROUTER_MODEL` | Нет | По умолчанию бесплатный роутер `openrouter/free` |
| `PUBLIC_SITE_URL` | Нет | Адрес сайта на Vercel |
| `AI_MINUTE_LIMIT` | Нет | По умолчанию 10 запросов в минуту |
| `AI_DAILY_LIMIT` | Нет | По умолчанию 50 запросов в день |

Код также понимает старые имена `SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_ROLE_KEY`, но для новых проектов рекомендуются publishable/secret keys.

После изменения переменных создайте новый deployment. Не отправляйте `SUPABASE_SECRET_KEY` и `OPENROUTER_API_KEY` в чат и не добавляйте их в Git.

## Локальный запуск

Нужен Node.js 24+:

```bash
npm install
npx vercel dev
```

Для локального `.env` скопируйте `.env.example`, замените значения и сохраните файл как `.env`; он исключён из Git.

## Что хранится в Supabase

- Supabase Auth: email/password и Google OAuth.
- `chats`: последние 60 диалогов пользователя.
- `progress`: статистика и XP.
- `ai_usage`: минутные и дневные лимиты AI, изменяемые только сервером.

Все пользовательские таблицы защищены Row Level Security. Сервер дополнительно проверяет актуального пользователя через `auth.getUser(access_token)` перед обращением к модели.

## Ограничения и безопасность

- Входные данные, длина истории и параметры AI-инструментов ограничены.
- Planner, flashcard и quiz запрашивают структурированный ответ по JSON Schema.
- Для контроля расходов задайте spending limit в OpenRouter.
- Frontend пока остаётся одним HTML-файлом с inline CSS/JS, поэтому CSP временно содержит `unsafe-inline`. Следующий логичный рефакторинг — вынести стили и скрипты в отдельные файлы и убрать это разрешение.
