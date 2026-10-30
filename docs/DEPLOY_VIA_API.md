# Как ИИ-агенту развернуть Google Apps Script проект в чужом Google-аккаунте через API

Инструкция для ИИ-агента с доступом к терминалу (Claude Code, Codex, Cursor и т.п.), который работает на **удалённом сервере**, а не на компьютере пользователя: у агента нет браузера пользователя и его Google-сессии. Всё делается через официальные API Google. От пользователя нужно несколько кликов и одно копирование адреса из браузера.

Проверено на этом проекте (CleanCRM: `Code.gs`, `Client.html`, `Admin.html`, `appsscript.json`).

---

## Что умеет этот способ и чего не умеет

| Можно через API | Только сам пользователь |
|---|---|
| Создать Google-таблицу и привязанный к ней проект Apps Script | Включить Apps Script API в своём аккаунте (один переключатель) |
| Загружать и обновлять код | Войти в Google и нажать «Разрешить» для clasp |
| Создавать и обновлять развертывание веб-приложения (URL не меняется) | Первый запуск функции в редакторе (`setup`): согласие на доступы скрипта даёт только владелец |
| Читать содержимое таблицы (экспорт через Drive API) | Открыть сайт, если у сервера агента нет доступа к `script.google.com` |

---

## Шаг 0. Что попросить у пользователя заранее

1. Включить **Google Apps Script API**: https://script.google.com/home/usersettings → переключатель «Вкл». Без этого `clasp create-script` и `clasp push` вернут ошибку *User has not enabled the Apps Script API*.
2. Быть готовым войти в Google по ссылке и прислать агенту адрес страницы, на которую его перекинет.

---

## Шаг 1. Установить clasp

clasp — официальный CLI Google для Apps Script. Нужна **версия 3.x**: в 2.x вход без локального сервера использует OOB-поток, который Google отключил в 2022 году (ошибка `invalid_request`).

```bash
npm i -g @google/clasp@3
clasp --version   # 3.x
```

---

## Шаг 2. Вход без браузера (`--no-localhost`)

Команда интерактивная: печатает ссылку и ждёт, пока в stdin вставят адрес после авторизации. Если инструмент агента не держит интерактивный процесс, запустите его в фоне, подав stdin через FIFO:

```bash
mkdir -p ~/clasp-login && cd ~/clasp-login
mkfifo in.fifo
(sleep 3600 > in.fifo &)                       # держит FIFO открытым
nohup sh -c "clasp login --no-localhost < in.fifo > login.log 2>&1" &
sleep 5; cat login.log                         # здесь ссылка https://accounts.google.com/o/oauth2/v2/auth?...
```

Отправьте пользователю ссылку из `login.log` и объясните:

- войти в нужный аккаунт и нажать **«Разрешить»** (при предупреждении «приложение не проверено» нажать «Дополнительно → Перейти»);
- браузер откроет `http://localhost:8888/?state=...&code=...` и покажет ошибку «не удаётся открыть сайт». **Это нормально**;
- скопировать адрес из адресной строки **целиком** и прислать агенту. Код живёт несколько минут.

Передайте адрес в процесс входа:

```bash
printf '%s\n' 'http://localhost:8888/?state=...&code=...' > ~/clasp-login/in.fifo
sleep 5; clasp show-authorized-user          # «You are logged in as user@gmail.com»
```

Токены сохраняются в `~/.clasprc.json` на сервере агента. **Никогда не выводите их в чат и не коммитьте.**

---

## Шаг 3. Создать таблицу и привязанный проект

```bash
mkdir deploy && cd deploy
clasp create-script --type sheets --title "CleanCRM"
# Created new document: https://drive.google.com/open?id=<SPREADSHEET_ID>
# Created new script:   https://script.google.com/d/<SCRIPT_ID>/edit
```

`--type sheets` создаёт Google-таблицу и **привязанный** к ней скрипт, поэтому `SpreadsheetApp.getActiveSpreadsheet()` работает. Сохраните оба ID: они понадобятся пользователю.

---

## Шаг 4. Загрузить код

```bash
cp ../Code.gs ../Client.html ../Admin.html ../appsscript.json .
clasp push --force
```

- В папке не должно быть одноимённых `.gs` и `.js` (`Code.gs` и `Code.js`), иначе получите **`Conflicting files found`**, и загрузка не пройдёт. Такой файл появляется после `clasp pull`: удалите его.
- `--force` перезаписывает манифест без вопроса.
- В `appsscript.json` задайте часовой пояс (`"timeZone": "Asia/Bishkek"`), V8 и права (`oauthScopes`). Там же блок `webapp` (`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`), чтобы сайт открывался всем.

---

## Шаг 5. Развернуть веб-приложение

```bash
clasp create-deployment --description "v1"
# Deployed AKfycb... @1
```

Адрес сайта: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`.

**Обновлять, сохраняя тот же URL:**

```bash
clasp push --force
clasp create-version "описание"                                         # Created version N
clasp update-deployment <DEPLOYMENT_ID> --versionNumber N --description "..."
```

Грабли:

- **Проверьте все развертывания:** `clasp list-deployments`. Пользователь мог создать своё в редакторе («Развернуть → Новое развертывание»), и тогда он открывает *другой* URL, а агент обновляет не тот. Обновляйте все, кроме `@HEAD`, или узнайте у пользователя, какая ссылка у него.
- Без `--versionNumber` команда `update-deployment` сама создаёт версию из текущего кода на сервере. Если `push` перед этим упал, в версию попадёт старый код. Сначала убедитесь, что `push` вывел «Pushed N files».
- Проверить, что ушло в версию: `clasp pull --versionNumber N` в отдельную пустую папку.

---

## Шаг 6. Первый запуск (делает пользователь)

Google не даёт согласиться на доступы скрипта (таблицы, почта) через API от имени пользователя. Попросите:

1. Открыть редактор: `https://script.google.com/d/<SCRIPT_ID>/edit`.
2. Выбрать функцию `setup` → **▶ Выполнить** → «Проверить разрешения» → аккаунт → «Дополнительно → Перейти» → **«Разрешить»**.

`clasp run` теоретически позволяет запускать функции удалённо, но для этого скрипт нужно привязать к собственному GCP-проекту пользователя и развернуть как API executable. Для разового `setup` проще попросить пользователя нажать кнопку.

---

## Шаг 7. Проверить данные в таблице

У OAuth-клиента clasp (GCP-проект Google) **Sheets API не включён**: вызовы `sheets.googleapis.com` с токеном clasp вернут `SERVICE_DISABLED`. Зато работает **Drive API**: таблицу, созданную clasp, можно экспортировать в xlsx и прочитать. Скоуп `drive.file` даёт доступ к файлам, которые создало это приложение.

```js
// node; токен берётся из ~/.clasprc.json
const rc = JSON.parse(require('fs').readFileSync(require('os').homedir() + '/.clasprc.json', 'utf8'));
const t = rc.tokens.default;
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
  body: new URLSearchParams({ client_id: t.client_id, client_secret: t.client_secret,
    refresh_token: t.refresh_token, grant_type: 'refresh_token' }) })).json()).access_token;
const r = await fetch(`https://www.googleapis.com/drive/v3/files/${SPREADSHEET_ID}/export?mimeType=` +
  encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  { headers: { authorization: 'Bearer ' + tok } });
require('fs').writeFileSync('sheet.xlsx', Buffer.from(await r.arrayBuffer()));
// дальше читать через openpyxl / SheetJS
```

**Изменять** данные так нельзя. Варианты:

- код в самом проекте: функция или разовая миграция, которая срабатывает при открытии сайта (`doGet` выполняется от имени владельца при `executeAs: USER_DEPLOYING`), защищённая флагом в `PropertiesService`, чтобы выполнилась один раз;
- коннектор Google Sheets у агента (MCP), если пользователь его подключил;
- попросить пользователя запустить функцию в редакторе.

---

## Шаг 8. Отзыв доступа

Когда работа закончена, пользователь отзывает доступ: https://myaccount.google.com/permissions → **clasp** → «Удалить доступ». Сервер агента обычно временный, но токен действует, пока его не отзовут.

---

## Подводные камни Apps Script и Google Sheets, найденные на этом проекте

1. **Галочки хранят FALSE в пустых строках.** Если на колонку повесить валидацию-чекбокс (`requireCheckbox()` или `insertCheckboxes()`), `getValues()` вернёт `false` во всех 1000 строках. Последствия:
   - код, который считает строку пустой только при `''`, увидит 999 «записей»;
   - `appendRow()` пишет ниже последней «занятой» строки, то есть в 1001-ю.

   Решение: считать `false` пустым значением и писать новую строку сразу после последней реально заполненной (`getRange(last + 1, ...).setValues(...)`), а не через `appendRow`.
2. **Даты и время превращаются в Date.** Строки вида `2026-10-21` и `10:00` Sheets автоматически конвертирует. Пишите их с апострофом (`"'" + value`) и ставьте формат колонки `@` (текст).
3. **Инъекция формул.** Пользовательский ввод, начинающийся с `= + - @`, Sheets выполнит как формулу. Экранируйте апострофом.
4. **Функции с `_` на конце приватные:** их нельзя вызвать через `google.script.run` и не видно в списке запуска редактора. Функцию, которую должен запускать пользователь, называйте без подчёркивания.
5. **Отправка почты ограничена квотой:** около 100 писем в сутки с обычного Gmail через `MailApp`.
6. **Сессии в `CacheService` живут максимум 6 часов.**
7. **Тестируйте локально.** Мини-эмулятор `SpreadsheetApp`, `CacheService`, `PropertiesService` и `MailApp` в Node плюс Playwright ловят большинство ошибок до деплоя. Эмулируйте реальное поведение Sheets (FALSE в галочках, автоконвертацию дат), иначе тесты пройдут, а прод сломается. Именно так мы сначала пропустили баг из пункта 1.

---

## Короткий чек-лист для агента

1. Пользователь включил Apps Script API.
2. `npm i -g @google/clasp@3`.
3. `clasp login --no-localhost` → ссылка пользователю → адрес обратно → `show-authorized-user`.
4. `clasp create-script --type sheets --title ...` → сохранить ID таблицы и скрипта.
5. Скопировать файлы → `clasp push --force`.
6. `clasp create-deployment` → выдать URL.
7. Пользователь запускает `setup` в редакторе и даёт разрешения.
8. Обновления: `push` → `create-version` → `update-deployment` для **всех** развертываний.
9. Проверка данных: экспорт через Drive API.
10. В конце пользователь отзывает доступ clasp.
