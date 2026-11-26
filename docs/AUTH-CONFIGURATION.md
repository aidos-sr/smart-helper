# Почта и Google-вход

Проект Supabase: `ctivgxhoaodagxeqwpzw`. Рабочий сайт: `https://smart-helper-six.vercel.app/`.

## Что подтверждено 26.11.2026

Публичный `/auth/v1/settings` рабочего проекта возвращает `external.google=false`, `external.email=true`, `disable_signup=false`, `mailer_autoconfirm=false`. Google-провайдер выключен; регистрация по email включена и требует подтверждения. Тип SMTP, его реквизиты, разрешённые redirect URL и OAuth Client Secret не раскрываются этим публичным ответом и независимо не проверены. Письма настоящим пользователям при диагностике не отправлялись.

Код сайта теперь ограничивает повторную отправку писем, показывает подтверждение регистрации и отдельную форму восстановления, учитывает Retry-After и доступность Google. Изменение формы само по себе не включает провайдера и не повышает серверную квоту отправки.

## Что настроить администратору в Supabase

### Отправка писем

В Authentication → Email / SMTP Settings подключите SMTP своей почтовой службы: Host, Port, Username, Password, Sender email и Sender name. Используйте подтверждённый адрес отправителя и настройки домена, выданные службой. Реквизиты вводятся в панели Supabase; их не нужно добавлять в код или переписку.

Если используется стандартная почта Supabase, она предназначена для тестирования: отправка ограничена адресами команды и двумя письмами в час на проект. Для регистрации обычных пользователей требуется Custom SMTP или Send Email Hook. После подключения SMTP проверьте Authentication → Rate Limits → Email: лимит должен соответствовать возможностям почтовой службы. Причиной 429 может быть и ранее выставленная небольшая квота при уже подключённом SMTP.

Email confirmation оставьте включённым. Регистрацию, подтверждение и сброс пароля нужно проверить на одном контролируемом адресе с реальной доставкой.

Источник: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

### Google

1. В Google Auth Platform / Cloud Console используйте OAuth Client типа Web application. Authorized JavaScript origin: `https://smart-helper-six.vercel.app`.
2. Authorized redirect URI Google: `https://ctivgxhoaodagxeqwpzw.supabase.co/auth/v1/callback`.
3. В Supabase Authentication → Sign In / Providers → Google включите провайдера, укажите Client ID и Client Secret этого OAuth-клиента и сохраните. Для приложения в режиме Testing добавьте контролируемые тестовые аккаунты в Google; доступ публикуется владельцем приложения.
4. В Supabase URL Configuration задайте Site URL `https://smart-helper-six.vercel.app`. В Redirect URLs разрешите рабочий адрес `https://smart-helper-six.vercel.app/`: новые письма и Google-вход используют этот общий возврат, а восстановление определяется событием PASSWORD_RECOVERY. Старые письма могут ссылаться на `https://smart-helper-six.vercel.app/#recovery`. Preview-адреса добавляйте отдельно по необходимости.
5. После сохранения обновите страницу сайта. Публичные настройки должны показывать `external.google=true`; затем проверьте выбор Google-аккаунта и возврат на сайт.

Источник: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Проверки после настройки

- Регистрация отправляет одно письмо, показывает экран ожидания и блокирует повторную отправку на время паузы.
- Ссылка подтверждения возвращает на рабочий домен; вход с паролем доступен после подтверждения.
- Восстановление запрашивает только email. Ссылка открывает форму нового пароля с повторным вводом; просроченная ссылка объясняется и допускает новый запрос.
- Google-вход возвращает пользователя на рабочий сайт. Публичный Google Client ID или один флаг frontend не заменяют настройку провайдера.
- На телефоне проверьте портретную и альбомную ориентацию, клавиатуру, меню и прокрутку чата. DOM-тесты не заменяют проверку настоящих Safari/Chrome на устройствах.
