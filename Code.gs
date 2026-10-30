/**
 * =====================================================================
 *  CleanCRM — веб-приложение клининговой компании
 *  Платформа: Google Apps Script, база данных: Google Sheets
 * =====================================================================
 *
 *  Структура проекта:
 *    Code.gs      — серверная логика (этот файл): роутинг, БД, API
 *    Client.html  — клиентский сайт (лендинг, запись, личный кабинет)
 *    Admin.html   — админка / CRM
 *
 *  URL-адреса (одно развертывание, разные параметры):
 *    https://script.google.com/macros/s/XXX/exec            — сайт
 *    https://script.google.com/macros/s/XXX/exec?page=admin — CRM
 *
 *  Первый запуск: выполните функцию setup() из редактора (см. README.md).
 *
 *  Соглашения:
 *    - Функции с "_" в конце — приватные (недоступны из google.script.run).
 *    - Даты хранятся строками "yyyy-MM-dd", время — "HH:mm",
 *      чтобы Google Sheets не превращал их в объекты Date.
 */

// ---------------------------------------------------------------------
//  КОНСТАНТЫ И СХЕМА БАЗЫ ДАННЫХ
// ---------------------------------------------------------------------

const SHEETS = {
  ORDERS: 'Заказы',
  CLIENTS: 'Клиенты',
  EMPLOYEES: 'Сотрудники',
  SERVICES: 'Услуги',
  PROMO: 'Промокоды',
  REVIEWS: 'Отзывы',
  CERTS: 'Сертификаты',
  BONUS: 'Бонусы',
  CONTENT: 'Контент',
  SETTINGS: 'Настройки'
};

/** Статусы заказа (хранятся в таблице как есть, по-русски) */
const STATUS = {
  NEW: 'В обработке',
  ASSIGNED: 'Назначен',
  IN_PROGRESS: 'Выполняется',
  DONE: 'Завершён',
  CANCELLED: 'Отменён'
};
const STATUS_LIST = [STATUS.NEW, STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.DONE, STATUS.CANCELLED];

const KIND_MAIN = 'Основная';
const KIND_EXTRA = 'Дополнительная';

const CERT_STATUS = { PENDING: 'Ожидает оплаты', ACTIVE: 'Активен', USED: 'Использован', CANCELLED: 'Аннулирован' };

/**
 * Схема листов: [ключ в коде, заголовок столбца в таблице].
 * Столбцы сопоставляются по заголовку, поэтому их можно переставлять.
 */
const SCHEMA = {
  [SHEETS.ORDERS]: [
    ['id', 'ID'], ['createdAt', 'Создан'], ['clientId', 'ID клиента'], ['name', 'Имя'],
    ['phone', 'Телефон'], ['email', 'Email'], ['serviceId', 'ID услуги'], ['serviceName', 'Услуга'],
    ['propertyType', 'Тип помещения'], ['rooms', 'Комнат'], ['date', 'Дата'], ['time', 'Время'],
    ['duration', 'Длительность, ч'], ['address', 'Адрес'], ['floor', 'Этаж'], ['elevator', 'Лифт'],
    ['pets', 'Животные'], ['extras', 'Доп. услуги (JSON)'], ['extrasText', 'Доп. услуги'],
    ['promoCode', 'Промокод'], ['referralCode', 'Реф. код'], ['certCode', 'Сертификат'],
    ['certUsed', 'Оплачено сертификатом'], ['bonusUsed', 'Списано бонусов'], ['subtotal', 'Сумма без скидок'],
    ['discount', 'Скидка'], ['total', 'Итого'], ['status', 'Статус'], ['employeeId', 'ID сотрудника'],
    ['employeeName', 'Сотрудник'], ['comment', 'Комментарий клиента'], ['notes', 'Внутренние заметки'],
    ['cancelReason', 'Причина отмены'], ['rating', 'Оценка'], ['review', 'Отзыв'],
    ['refunded', 'Возврат проведён'], ['updatedAt', 'Обновлён']
  ],
  [SHEETS.CLIENTS]: [
    ['id', 'ID'], ['createdAt', 'Создан'], ['name', 'Имя'], ['phone', 'Телефон'], ['email', 'Email'],
    ['address', 'Адрес'], ['referralCode', 'Реферальный код'], ['referredBy', 'Приглашён (ID клиента)'],
    ['vip', 'VIP'], ['notes', 'Заметки']
  ],
  [SHEETS.EMPLOYEES]: [
    ['id', 'ID'], ['active', 'Активен'], ['name', 'Имя'], ['role', 'Должность'], ['phone', 'Телефон'],
    ['photo', 'Фото (URL)'], ['bio', 'О сотруднике'], ['workDays', 'Рабочие дни (1-7)'],
    ['workFrom', 'Начало смены'], ['workTo', 'Конец смены'], ['showOnSite', 'Показывать на сайте']
  ],
  [SHEETS.SERVICES]: [
    ['id', 'ID'], ['active', 'Активна'], ['kind', 'Тип'], ['name', 'Название'], ['icon', 'Иконка'],
    ['short', 'Кратко'], ['description', 'Описание'], ['basePrice', 'Базовая цена'],
    ['perRoom', 'Цена за комнату'], ['unit', 'Ед. изм.'], ['baseHours', 'Базовое время, ч'],
    ['perRoomHours', 'Время на комнату, ч'], ['includes', 'Что входит (через ;)'],
    ['paidExtras', 'За доплату (через ;)'], ['excludes', 'Не входит (через ;)'],
    ['image', 'Изображение (URL)'], ['sort', 'Порядок']
  ],
  [SHEETS.PROMO]: [
    ['code', 'Код'], ['active', 'Активен'], ['type', 'Тип (%/сом)'], ['value', 'Значение'],
    ['minOrder', 'Мин. сумма'], ['validFrom', 'Действует с'], ['validTo', 'Действует до'],
    ['maxUses', 'Лимит использований'], ['used', 'Использован раз'], ['description', 'Описание']
  ],
  [SHEETS.REVIEWS]: [
    ['id', 'ID'], ['date', 'Дата'], ['author', 'Автор'], ['rating', 'Оценка'], ['text', 'Текст'],
    ['source', 'Источник'], ['orderId', 'ID заказа'], ['clientId', 'ID клиента'],
    ['employeeId', 'ID сотрудника'], ['published', 'Опубликован'], ['avatar', 'Аватар (URL)']
  ],
  [SHEETS.CERTS]: [
    ['code', 'Код'], ['createdAt', 'Создан'], ['amount', 'Номинал'], ['balance', 'Остаток'],
    ['status', 'Статус'], ['buyerName', 'Покупатель'], ['buyerPhone', 'Телефон покупателя'],
    ['buyerEmail', 'Email покупателя'], ['recipientName', 'Получатель'], ['recipientEmail', 'Email получателя'],
    ['message', 'Поздравление'], ['validTo', 'Действует до']
  ],
  [SHEETS.BONUS]: [
    ['id', 'ID'], ['date', 'Дата'], ['clientId', 'ID клиента'], ['amount', 'Сумма'],
    ['reason', 'Причина'], ['orderId', 'ID заказа']
  ],
  [SHEETS.CONTENT]: [
    ['id', 'ID'], ['section', 'Раздел'], ['title', 'Заголовок'], ['text', 'Текст'],
    ['image', 'Изображение 1'], ['image2', 'Изображение 2'], ['sort', 'Порядок'], ['active', 'Активен']
  ],
  [SHEETS.SETTINGS]: [
    ['key', 'Ключ'], ['value', 'Значение'], ['description', 'Описание']
  ]
};

/** Поля, которые всегда пишутся как текст (защита от автоконвертации Sheets) */
const TEXT_KEYS = {
  date: 1, time: 1, phone: 1, buyerPhone: 1, validFrom: 1, validTo: 1, workFrom: 1, workTo: 1,
  code: 1, promoCode: 1, referralCode: 1, certCode: 1, createdAt: 1, updatedAt: 1, value: 1, workDays: 1
};
const BOOL_KEYS = { active: 1, elevator: 1, pets: 1, vip: 1, published: 1, showOnSite: 1, refunded: 1 };
const DATE_KEYS = { date: 1, validFrom: 1, validTo: 1 };
const TIME_KEYS = { time: 1, workFrom: 1, workTo: 1 };

/** Настройки по умолчанию: [ключ, значение, описание]. Редактируются на листе «Настройки» или в админке. */
const DEFAULT_SETTINGS = [
  ['companyName', 'Чистый Дом', 'Название компании'],
  ['slogan', 'Мы убираем — вы отдыхаете', 'Слоган на главной'],
  ['subSlogan', 'Профессиональная уборка квартир, домов и офисов. Проверенные клинеры, экосредства и фиксированная цена.', 'Подзаголовок на главной'],
  ['phone', '+996 (700) 123-456', 'Телефон компании'],
  ['email', 'hello@example.com', 'Email компании'],
  ['address', 'Бишкек, пр. Чуй, 155', 'Адрес офиса'],
  ['mapQuery', 'Бишкек, проспект Чуй, 155', 'Адрес для Google Maps'],
  ['workHoursText', 'Ежедневно 8:00–21:00', 'Часы работы (текст)'],
  ['currency', 'сом', 'Валюта (подпись после суммы)'],
  ['adminEmail', '', 'Email для уведомлений о новых заказах'],
  ['adminEmails', '', 'Google-аккаунты с доступом к CRM без пароля (через запятую)'],
  ['coefFlat', '1', 'Коэффициент цены: квартира'],
  ['coefHouse', '1.3', 'Коэффициент цены: дом'],
  ['coefOffice', '1.2', 'Коэффициент цены: офис'],
  ['petsSurcharge', '300', 'Надбавка за домашних животных'],
  ['noElevatorPerFloor', '30', 'Надбавка за этаж без лифта (начиная со 2-го)'],
  ['minOrder', '2000', 'Минимальная сумма заказа'],
  ['workStart', '08:00', 'Начало рабочего дня (первый слот)'],
  ['workEnd', '21:00', 'Конец рабочего дня (уборка должна закончиться до)'],
  ['slotStep', '60', 'Шаг слотов в календаре, минут'],
  ['maxParallel', '', 'Сколько заказов одновременно (пусто = число активных сотрудников)'],
  ['bookingDaysAhead', '60', 'На сколько дней вперёд открыта запись'],
  ['minLeadHours', '3', 'Минимум часов от текущего момента до начала уборки'],
  ['cancelHours', '12', 'За сколько часов клиент может сам отменить/перенести заказ'],
  ['referralDiscount', '10', 'Скидка другу по реферальному коду, % (на первый заказ)'],
  ['referralBonus', '300', 'Бонус пригласившему после первого выполненного заказа друга'],
  ['bonusPercent', '5', 'Кэшбэк бонусами от суммы выполненного заказа, %'],
  ['maxBonusPercent', '30', 'Максимум оплаты бонусами, % от заказа'],
  ['statOrdersBase', '1200', 'Счётчик «выполненных заказов»: стартовое значение (+ реальные из базы)'],
  ['statClientsBase', '800', 'Счётчик «довольных клиентов»: стартовое значение (+ реальные из базы)'],
  ['statYears', '7', 'Лет на рынке'],
  ['reactivationDays', '60', 'Через сколько дней без заказов клиент попадает в реактивацию'],
  ['instagram', 'https://instagram.com/', 'Instagram'],
  ['telegram', 'https://t.me/', 'Telegram'],
  ['whatsapp', 'https://wa.me/996700123456', 'WhatsApp'],
  ['vk', '', 'ВКонтакте (пусто — не показывать)'],
  ['googleReviewsUrl', 'https://www.google.com/maps', 'Ссылка на отзывы в Google Maps']
];

/** Ключи настроек, которые можно отдавать на клиентский сайт */
const PUBLIC_SETTING_KEYS = [
  'companyName', 'slogan', 'subSlogan', 'phone', 'email', 'address', 'mapQuery', 'workHoursText',
  'currency', 'petsSurcharge', 'noElevatorPerFloor', 'minOrder', 'bookingDaysAhead', 'referralDiscount',
  'referralBonus', 'bonusPercent', 'maxBonusPercent', 'cancelHours', 'statYears', 'instagram', 'telegram',
  'whatsapp', 'vk', 'googleReviewsUrl'
];

const TOKEN_TTL = 21600; // 6 часов — максимум для CacheService

// ---------------------------------------------------------------------
//  ТОЧКА ВХОДА WEB APP
// ---------------------------------------------------------------------

/**
 * Роутинг: ?page=admin — CRM, иначе — клиентский сайт.
 * Данные для первой отрисовки встраиваются прямо в HTML (BOOT),
 * чтобы страница открывалась без дополнительного запроса к серверу.
 */
function doGet(e) {
  try { migrateToKyrgyzstan_(); } catch (err) { console.warn('KG migration: ' + err); }
  const params = (e && e.parameter) || {};
  const isAdmin = params.page === 'admin';
  const tpl = HtmlService.createTemplateFromFile(isAdmin ? 'Admin' : 'Client');
  const settings = getSettings_();
  tpl.bootJson = safeJson_(isAdmin ? adminBoot_() : publicData_());
  tpl.appUrl = ScriptApp.getService().getUrl() || '';
  return tpl.evaluate()
    .setTitle(isAdmin ? 'CRM · ' + settings.companyName : settings.companyName + ' — клининг')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Разовый переход на стартовые данные для Кыргызстана (сом, Бишкек, +996)
 * в таблице, созданной прежней версией setup() с рублями.
 * Срабатывает один раз и только пока в базе нет ни заказов, ни клиентов,
 * поэтому рабочие данные не затрагивает. Справочные листы пересоздаются.
 */
function migrateToKyrgyzstan_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('KG_DEFAULTS_V2')) return;
  withLock_(function () {
    if (props.getProperty('KG_DEFAULTS_V2')) return;
    if (getSettings_().currency === '₽' && !readAll_(SHEETS.ORDERS).length && !readAll_(SHEETS.CLIENTS).length) {
      const ss = ss_();
      [SHEETS.SETTINGS, SHEETS.SERVICES, SHEETS.EMPLOYEES, SHEETS.PROMO, SHEETS.REVIEWS, SHEETS.CONTENT].forEach(function (n) {
        const sh = ss.getSheetByName(n);
        if (sh) ss.deleteSheet(sh);
      });
      setup();
    }
    props.setProperty('KG_DEFAULTS_V2', '1');
  });
}

/** JSON, безопасный для вставки внутрь <script> */
function safeJson_(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Меню в таблице */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧽 CleanCRM')
    .addItem('Первичная настройка (создать листы)', 'setup')
    .addItem('Добавить демо-заказы', 'seedDemoOrders')
    .addItem('Сменить пароль админки', 'promptAdminPassword')
    .addToUi();
}

// ---------------------------------------------------------------------
//  СЛОЙ ДАННЫХ (обёртка над SpreadsheetApp)
// ---------------------------------------------------------------------

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Лист «' + name + '» не найден. Запустите setup().');
  return sh;
}

/** Соответствие столбцов листа ключам схемы (по заголовкам первой строки) */
function headerKeys_(name, headerRow) {
  const map = {};
  (SCHEMA[name] || []).forEach(function (p) { map[p[1]] = p[0]; map[p[0]] = p[0]; });
  map['Тип (%/₽)'] = map['Тип (%/₽)'] || (name === SHEETS.PROMO ? 'type' : ''); // заголовок прежних версий
  return headerRow.map(function (h) { return map[String(h).trim()] || ''; });
}

/** Приведение значения ячейки к удобному для JS виду */
function normalize_(key, v) {
  if (v instanceof Date) {
    const tz = Session.getScriptTimeZone();
    if (DATE_KEYS[key]) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (TIME_KEYS[key]) return Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
  }
  if (BOOL_KEYS[key]) return toBool_(v);
  return v;
}

/** Значение для записи в ячейку (с защитой от формул и автоконвертации) */
function cell_(key, v) {
  if (v === undefined || v === null) return '';
  if (BOOL_KEYS[key]) return toBool_(v);
  if (typeof v === 'boolean' || typeof v === 'number') return v;
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  if (v === '') return '';
  if (TEXT_KEYS[key] || /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/** Все строки листа как массив объектов. У каждого объекта есть служебное поле _row. */
function readAll_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const keys = headerKeys_(name, values[0]);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (isBlankRow_(row)) continue;
    const o = { _row: r + 1 };
    keys.forEach(function (k, i) { if (k) o[k] = normalize_(k, row[i]); });
    out.push(o);
  }
  return out;
}

function sheetKeys_(name) {
  const sh = sheet_(name);
  return headerKeys_(name, sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
}

/**
 * Пустая ли строка. Ячейки с галочкой хранят FALSE даже в незаполненных
 * строках, поэтому FALSE тоже считается пустым значением.
 */
function isBlankRow_(row) {
  return row.every(function (v) { return v === '' || v === null || v === false; });
}

/**
 * Добавляет запись сразу после последней заполненной строки.
 * appendRow не подходит: из-за FALSE в заготовленных галочках Sheets считает
 * занятыми все 1000 строк и дописывал бы новые записи ниже них.
 */
function insert_(name, obj) {
  const sh = sheet_(name);
  const keys = sheetKeys_(name);
  const values = sh.getDataRange().getValues();
  let last = values.length;
  while (last > 1 && isBlankRow_(values[last - 1])) last--;
  if (last + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  sh.getRange(last + 1, 1, 1, keys.length).setValues([keys.map(function (k) { return k ? cell_(k, obj[k]) : ''; })]);
  return obj;
}

/** Найти строку по ключевому полю (id или code) */
function findBy_(name, field, value) {
  const v = String(value).trim().toUpperCase();
  return readAll_(name).find(function (r) { return String(r[field]).trim().toUpperCase() === v; }) || null;
}

/** Частичное обновление строки, найденной по полю */
function update_(name, field, value, patch) {
  const row = findBy_(name, field, value);
  if (!row) throw new Error('Запись не найдена: ' + value);
  const keys = sheetKeys_(name);
  const merged = Object.assign({}, row, patch);
  sheet_(name).getRange(row._row, 1, 1, keys.length)
    .setValues([keys.map(function (k) { return k ? cell_(k, merged[k]) : ''; })]);
  return merged;
}

function remove_(name, field, value) {
  const row = findBy_(name, field, value);
  if (!row) throw new Error('Запись не найдена: ' + value);
  sheet_(name).deleteRow(row._row);
}

/** Выполнить функцию под глобальной блокировкой (защита от одновременной записи) */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Последовательный ID вида ORD-1001 */
function nextId_(prefix, start) {
  const props = PropertiesService.getScriptProperties();
  const key = 'SEQ_' + prefix;
  const n = Number(props.getProperty(key) || start || 1000) + 1;
  props.setProperty(key, String(n));
  return prefix + '-' + n;
}

/** Убрать служебные поля перед отправкой клиенту */
function strip_(o) {
  const c = Object.assign({}, o);
  delete c._row;
  return c;
}

// ---------------------------------------------------------------------
//  УТИЛИТЫ
// ---------------------------------------------------------------------

function toBool_(v) {
  if (v === true) return true;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'да' || s === '1' || s === 'yes' || s === 'on';
}
function num_(v) { const n = Number(String(v).replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? n : 0; }
function clamp_(v, a, b) { return Math.max(a, Math.min(b, v)); }
function round10_(v) { return Math.round(v / 10) * 10; }
function tz_() { return Session.getScriptTimeZone(); }
function fmt_(d, pattern) { return Utilities.formatDate(d, tz_(), pattern || 'yyyy-MM-dd'); }
function nowStr_() { return fmt_(new Date(), 'yyyy-MM-dd HH:mm'); }
function today_() { return fmt_(new Date()); }
function parseDate_(s) { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays_(s, n) { const d = parseDate_(s); d.setDate(d.getDate() + n); return fmt_(d); }
function daysBetween_(a, b) { return Math.round((parseDate_(b) - parseDate_(a)) / 86400000); }
function toMin_(t) { const p = String(t || '0:0').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
function fromMin_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function orderStart_(o) { const d = parseDate_(o.date); const m = toMin_(o.time); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d; }
function digits_(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 10 && d.charAt(0) === '0') d = '996' + d.slice(1); // местный формат КР: 0700 123 456
  else if (d.length === 9) d = '996' + d;                             // без кода страны: 700 123 456
  else if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1); // РФ/КЗ: 8 900 ...
  return d;
}
function normPhone_(s) { const d = digits_(s); return d ? '+' + d : ''; }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }
function randCode_(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function money_(v, st) { return Math.round(num_(v)).toLocaleString('ru-RU') + ' ' + ((st && st.currency) || 'сом'); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/** Ссылку вида drive.google.com/file/d/ID/... превращаем в прямую ссылку на изображение */
function driveImg_(url) {
  const s = String(url || '').trim();
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
  return m ? 'https://lh3.googleusercontent.com/d/' + m[1] : s;
}

/** Строка "a; b; c" -> массив */
function list_(s) { return String(s || '').split(/;|\n/).map(function (x) { return x.trim(); }).filter(String); }

// ---------------------------------------------------------------------
//  НАСТРОЙКИ
// ---------------------------------------------------------------------

function getSettings_() {
  const st = {};
  DEFAULT_SETTINGS.forEach(function (d) { st[d[0]] = d[1]; });
  try {
    readAll_(SHEETS.SETTINGS).forEach(function (r) { if (r.key) st[String(r.key).trim()] = String(r.value); });
  } catch (e) { /* лист ещё не создан */ }
  return st;
}

function saveSettings_(obj) {
  const rows = readAll_(SHEETS.SETTINGS);
  const sh = sheet_(SHEETS.SETTINGS);
  const keys = sheetKeys_(SHEETS.SETTINGS);
  const valueCol = keys.indexOf('value') + 1;
  Object.keys(obj).forEach(function (k) {
    if (k === 'adminPassword') return;
    const row = rows.find(function (r) { return r.key === k; });
    if (row) sh.getRange(row._row, valueCol).setValue(cell_('value', obj[k]));
    else insert_(SHEETS.SETTINGS, { key: k, value: obj[k], description: '' });
  });
}

function propertyTypes_(st) {
  return [
    { id: 'flat', name: 'Квартира', coef: num_(st.coefFlat) || 1 },
    { id: 'house', name: 'Дом', coef: num_(st.coefHouse) || 1 },
    { id: 'office', name: 'Офис', coef: num_(st.coefOffice) || 1 }
  ];
}

function capacity_(st) {
  const manual = parseInt(st.maxParallel, 10);
  if (manual > 0) return manual;
  const n = readAll_(SHEETS.EMPLOYEES).filter(function (e) { return e.active; }).length;
  return Math.max(1, n);
}

// ---------------------------------------------------------------------
//  ПУБЛИЧНЫЕ ДАННЫЕ ДЛЯ САЙТА
// ---------------------------------------------------------------------

function publicData_() {
  const st = getSettings_();
  const settings = {};
  PUBLIC_SETTING_KEYS.forEach(function (k) { settings[k] = st[k]; });

  const services = readAll_(SHEETS.SERVICES)
    .filter(function (s) { return s.active; })
    .sort(function (a, b) { return num_(a.sort) - num_(b.sort); })
    .map(function (s) {
      return {
        id: String(s.id), kind: s.kind, name: s.name, icon: s.icon, short: s.short, description: s.description,
        basePrice: num_(s.basePrice), perRoom: num_(s.perRoom), unit: s.unit,
        baseHours: num_(s.baseHours), perRoomHours: num_(s.perRoomHours),
        includes: list_(s.includes), paidExtras: list_(s.paidExtras), excludes: list_(s.excludes),
        image: driveImg_(s.image)
      };
    });

  const team = readAll_(SHEETS.EMPLOYEES)
    .filter(function (e) { return e.active && e.showOnSite; })
    .map(function (e) { return { name: e.name, role: e.role, bio: e.bio, photo: driveImg_(e.photo) }; });

  const reviews = readAll_(SHEETS.REVIEWS)
    .filter(function (r) { return r.published; })
    .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
    .slice(0, 30)
    .map(function (r) {
      return { author: r.author, rating: num_(r.rating) || 5, text: r.text, date: r.date, source: r.source, avatar: driveImg_(r.avatar) };
    });

  const content = {};
  readAll_(SHEETS.CONTENT)
    .filter(function (c) { return c.active; })
    .sort(function (a, b) { return num_(a.sort) - num_(b.sort); })
    .forEach(function (c) {
      (content[c.section] = content[c.section] || []).push({
        title: c.title, text: c.text, image: driveImg_(c.image), image2: driveImg_(c.image2)
      });
    });

  // Счётчики: стартовое значение + реальные данные из базы
  const orders = readAll_(SHEETS.ORDERS);
  const done = orders.filter(function (o) { return o.status === STATUS.DONE; }).length;
  const clients = readAll_(SHEETS.CLIENTS).length;

  return {
    settings: settings,
    propertyTypes: propertyTypes_(st),
    services: services,
    team: team,
    reviews: reviews,
    content: content,
    stats: {
      orders: num_(st.statOrdersBase) + done,
      clients: num_(st.statClientsBase) + clients,
      years: num_(st.statYears)
    },
    statuses: STATUS
  };
}

/** Обновить публичные данные (на случай, если страница открыта давно) */
function getPublicData() { return publicData_(); }

// ---------------------------------------------------------------------
//  РАСЧЁТ СТОИМОСТИ (единственный источник истины — сервер)
// ---------------------------------------------------------------------

/**
 * Считает стоимость заказа.
 * payload: { serviceId, propertyType, rooms, extras:[{id,qty}], pets, floor, elevator,
 *            promoCode, certCode, useBonus, phone, email }
 * Цена = (базовая + цена_за_комнату × комнаты) × коэффициент_помещения + доп.услуги + надбавки
 * Скидка: промокод ИЛИ реферальная скидка (на первый заказ). Затем сертификат и бонусы.
 */
function calcQuote_(p, clientId) {
  p = p || {};
  const st = getSettings_();
  const services = readAll_(SHEETS.SERVICES).filter(function (s) { return s.active; });
  const main = services.find(function (s) { return String(s.id) === String(p.serviceId) && s.kind === KIND_MAIN; });
  if (!main) throw new Error('Выберите тип уборки');
  const types = propertyTypes_(st);
  const pt = types.find(function (t) { return t.id === p.propertyType; }) || types[0];
  const rooms = clamp_(parseInt(p.rooms, 10) || 1, 1, 20);

  const lines = [];
  const base = round10_((num_(main.basePrice) + num_(main.perRoom) * rooms) * pt.coef);
  lines.push({ name: main.name + ' · ' + pt.name + ', ' + rooms + ' комн.', amount: base });
  let hours = (num_(main.baseHours) + num_(main.perRoomHours) * rooms) * pt.coef;

  const extras = [];
  (p.extras || []).forEach(function (e) {
    const s = services.find(function (x) { return String(x.id) === String(e.id) && x.kind === KIND_EXTRA; });
    const qty = clamp_(parseInt(e.qty, 10) || 0, 0, 50);
    if (!s || !qty) return;
    const amount = num_(s.basePrice) * qty;
    extras.push({ id: String(s.id), name: s.name, qty: qty, price: num_(s.basePrice), amount: amount });
    lines.push({ name: s.name + (qty > 1 ? ' × ' + qty : ''), amount: amount });
    hours += num_(s.baseHours) * qty;
  });

  if (toBool_(p.pets) && num_(st.petsSurcharge)) lines.push({ name: 'Домашние животные', amount: num_(st.petsSurcharge) });
  const floor = parseInt(p.floor, 10) || 1;
  if (!toBool_(p.elevator) && floor > 1 && num_(st.noElevatorPerFloor) && pt.id !== 'house') {
    lines.push({ name: 'Подъём без лифта (' + floor + ' этаж)', amount: (floor - 1) * num_(st.noElevatorPerFloor) });
  }

  let subtotal = lines.reduce(function (a, l) { return a + l.amount; }, 0);
  const minOrder = num_(st.minOrder);
  if (subtotal < minOrder) {
    lines.push({ name: 'Доплата до минимального заказа', amount: minOrder - subtotal });
    subtotal = minOrder;
  }

  // --- Определяем клиента (для реферальной скидки и бонусов)
  let client = null;
  if (clientId) client = findBy_(SHEETS.CLIENTS, 'id', clientId);
  if (!client && (p.phone || p.email)) client = findClient_(p.phone, p.email);
  const clientOrders = client ? readAll_(SHEETS.ORDERS).filter(function (o) {
    return String(o.clientId) === String(client.id) && o.status !== STATUS.CANCELLED;
  }) : [];

  // --- Промокод / реферальный код
  const messages = [];
  let discount = 0, discountLabel = '', promoCode = '', referralCode = '', referrerId = '';
  const code = String(p.promoCode || '').trim().toUpperCase();
  if (code) {
    const promo = findBy_(SHEETS.PROMO, 'code', code);
    const referrer = promo ? null : findBy_(SHEETS.CLIENTS, 'referralCode', code);
    if (promo) {
      const err = promoError_(promo, subtotal);
      if (err) messages.push({ type: 'error', text: err });
      else {
        const isPct = String(promo.type).indexOf('%') >= 0;
        discount = isPct ? Math.round(subtotal * num_(promo.value) / 100) : num_(promo.value);
        discountLabel = 'Промокод ' + promo.code + (isPct ? ' (−' + num_(promo.value) + '%)' : '');
        promoCode = String(promo.code).toUpperCase();
        messages.push({ type: 'ok', text: 'Промокод применён' });
      }
    } else if (referrer) {
      if (client && String(client.id) === String(referrer.id)) {
        messages.push({ type: 'error', text: 'Нельзя использовать собственный реферальный код' });
      } else if (clientOrders.length > 0) {
        messages.push({ type: 'error', text: 'Реферальная скидка действует только на первый заказ' });
      } else {
        discount = Math.round(subtotal * num_(st.referralDiscount) / 100);
        discountLabel = 'Скидка по приглашению (−' + num_(st.referralDiscount) + '%)';
        referralCode = code;
        referrerId = String(referrer.id);
        messages.push({ type: 'ok', text: 'Реферальный код применён' });
      }
    } else {
      messages.push({ type: 'error', text: 'Промокод не найден' });
    }
  }
  discount = Math.min(discount, subtotal);
  let total = subtotal - discount;

  // --- Подарочный сертификат
  let certApplied = 0, certCode = '';
  const cc = String(p.certCode || '').trim().toUpperCase();
  if (cc) {
    const cert = findBy_(SHEETS.CERTS, 'code', cc);
    if (!cert) messages.push({ type: 'error', text: 'Сертификат не найден' });
    else if (cert.status !== CERT_STATUS.ACTIVE || num_(cert.balance) <= 0) messages.push({ type: 'error', text: 'Сертификат не активен или уже использован' });
    else if (cert.validTo && String(cert.validTo) < today_()) messages.push({ type: 'error', text: 'Срок действия сертификата истёк' });
    else {
      certApplied = Math.min(num_(cert.balance), total);
      certCode = cc;
      messages.push({ type: 'ok', text: 'Сертификат применён: −' + money_(certApplied, st) });
    }
  }
  total -= certApplied;

  // --- Бонусы (только для авторизованного клиента)
  let bonusAvailable = 0, bonusApplied = 0;
  if (clientId) {
    bonusAvailable = bonusBalance_(clientId);
    if (toBool_(p.useBonus) && bonusAvailable > 0) {
      const maxByOrder = Math.floor((subtotal - discount) * num_(st.maxBonusPercent) / 100);
      bonusApplied = Math.max(0, Math.min(bonusAvailable, maxByOrder, total));
    }
  }
  total -= bonusApplied;

  return {
    lines: lines, extras: extras, subtotal: subtotal, discount: discount, discountLabel: discountLabel,
    promoCode: promoCode, referralCode: referralCode, referrerId: referrerId,
    certCode: certCode, certApplied: certApplied, bonusAvailable: bonusAvailable, bonusApplied: bonusApplied,
    total: Math.max(0, Math.round(total)),
    duration: Math.max(2, Math.ceil(hours * 2) / 2),
    serviceName: main.name, propertyTypeName: pt.name, rooms: rooms, messages: messages
  };
}

function promoError_(promo, subtotal) {
  const t = today_();
  if (!promo.active) return 'Промокод неактивен';
  if (promo.validFrom && String(promo.validFrom) > t) return 'Промокод ещё не действует';
  if (promo.validTo && String(promo.validTo) < t) return 'Срок действия промокода истёк';
  if (num_(promo.maxUses) > 0 && num_(promo.used) >= num_(promo.maxUses)) return 'Лимит использований промокода исчерпан';
  if (num_(promo.minOrder) > subtotal) return 'Промокод действует от ' + money_(promo.minOrder, getSettings_());
  return '';
}

/** Публичный расчёт стоимости (кнопка «Проверить» и подтверждение перед отправкой) */
function getQuote(payload, token) {
  const clientId = token ? clientIdFromToken_(token, true) : '';
  return calcQuote_(payload, clientId);
}

// ---------------------------------------------------------------------
//  КАЛЕНДАРЬ И СВОБОДНЫЕ СЛОТЫ
// ---------------------------------------------------------------------

/**
 * Слоты на дату. Слот занят, если число пересекающихся по времени
 * активных заказов >= вместимости (кол-во бригад/сотрудников).
 */
function daySlots_(date, duration, excludeId, ctx) {
  ctx = ctx || slotCtx_();
  const st = ctx.st;
  const start = toMin_(st.workStart), end = toMin_(st.workEnd);
  const step = Math.max(15, parseInt(st.slotStep, 10) || 60);
  const dur = Math.round(Math.max(1, num_(duration) || 2) * 60);
  const minStart = new Date(Date.now() + num_(st.minLeadHours) * 3600000);
  const lastDay = addDays_(today_(), parseInt(st.bookingDaysAhead, 10) || 60);
  if (date < today_() || date > lastDay) return [];

  const dayOrders = (ctx.byDate[date] || []).filter(function (o) { return String(o.id) !== String(excludeId || ''); });
  const slots = [];
  const latest = Math.max(start, end - dur);
  for (let m = start; m <= latest; m += step) {
    const s = parseDate_(date); s.setHours(Math.floor(m / 60), m % 60, 0, 0);
    let busy = 0;
    dayOrders.forEach(function (o) {
      const os = toMin_(o.time), oe = os + Math.round(num_(o.duration || 2) * 60);
      if (os < m + dur && m < oe) busy++;
    });
    slots.push({ time: fromMin_(m), free: s >= minStart && busy < ctx.capacity });
  }
  return slots;
}

function slotCtx_() {
  const st = getSettings_();
  const byDate = {};
  readAll_(SHEETS.ORDERS).forEach(function (o) {
    if (o.status === STATUS.CANCELLED || o.status === STATUS.DONE && o.date < today_()) return;
    (byDate[o.date] = byDate[o.date] || []).push(o);
  });
  return { st: st, byDate: byDate, capacity: capacity_(st) };
}

/** Слоты на конкретный день */
function getDaySlots(date, duration, excludeId) {
  return daySlots_(String(date), duration, excludeId);
}

/** Сводка по месяцу: сколько свободных слотов в каждом дне (для календаря) */
function getMonthAvailability(ym, duration, excludeId) {
  const ctx = slotCtx_();
  const p = String(ym).split('-');
  const y = +p[0], m = +p[1];
  const days = new Date(y, m, 0).getDate();
  const res = {};
  for (let d = 1; d <= days; d++) {
    const ds = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
    const slots = daySlots_(ds, duration, excludeId, ctx);
    res[ds] = slots.length ? slots.filter(function (s) { return s.free; }).length : -1; // -1 — запись закрыта
  }
  return res;
}

function isSlotFree_(date, time, duration, excludeId) {
  const slot = daySlots_(date, duration, excludeId).find(function (s) { return s.time === time; });
  return !!(slot && slot.free);
}

// ---------------------------------------------------------------------
//  КЛИЕНТЫ
// ---------------------------------------------------------------------

function findClient_(phone, email) {
  const d = digits_(phone);
  const em = String(email || '').trim().toLowerCase();
  const all = readAll_(SHEETS.CLIENTS);
  return all.find(function (c) { return d && d.length >= 10 && digits_(c.phone) === d; }) ||
    all.find(function (c) { return em && String(c.email).trim().toLowerCase() === em; }) || null;
}

function newReferralCode_() {
  let code;
  do { code = 'REF-' + randCode_(6); } while (findBy_(SHEETS.CLIENTS, 'referralCode', code));
  return code;
}

/** Найти или создать клиента при оформлении заказа */
function upsertClient_(data, referrerId) {
  let c = findClient_(data.phone, data.email);
  if (!c) {
    c = {
      id: nextId_('CL', 1000), createdAt: nowStr_(), name: data.name, phone: normPhone_(data.phone),
      email: String(data.email || '').trim().toLowerCase(), address: data.address,
      referralCode: newReferralCode_(), referredBy: referrerId || '', vip: false, notes: ''
    };
    insert_(SHEETS.CLIENTS, c);
    return c;
  }
  const patch = {};
  if (!c.email && data.email) patch.email = String(data.email).trim().toLowerCase();
  if (!c.phone && data.phone) patch.phone = normPhone_(data.phone);
  if (!c.address && data.address) patch.address = data.address;
  if (!c.referralCode) patch.referralCode = newReferralCode_();
  if (!c.referredBy && referrerId && String(referrerId) !== String(c.id)) patch.referredBy = referrerId;
  return Object.keys(patch).length ? update_(SHEETS.CLIENTS, 'id', c.id, patch) : c;
}

function bonusBalance_(clientId) {
  return readAll_(SHEETS.BONUS)
    .filter(function (b) { return String(b.clientId) === String(clientId); })
    .reduce(function (a, b) { return a + num_(b.amount); }, 0);
}

function addBonus_(clientId, amount, reason, orderId) {
  if (!clientId || !amount) return;
  insert_(SHEETS.BONUS, { id: nextId_('B', 0), date: nowStr_(), clientId: clientId, amount: Math.round(amount), reason: reason, orderId: orderId || '' });
}

// ---------------------------------------------------------------------
//  ОНЛАЙН-ЗАПИСЬ
// ---------------------------------------------------------------------

/**
 * Создание заказа с сайта.
 * Стоимость пересчитывается на сервере, слот перепроверяется под блокировкой.
 */
function createBooking(p, token) {
  p = p || {};
  const clientIdFromAuth = token ? clientIdFromToken_(token, true) : '';
  if (!String(p.name || '').trim()) throw new Error('Укажите имя');
  if (digits_(p.phone).length < 10) throw new Error('Укажите корректный телефон');
  if (!isEmail_(p.email)) throw new Error('Укажите корректный email — он нужен для входа в личный кабинет');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || !/^\d{2}:\d{2}$/.test(p.time || '')) throw new Error('Выберите дату и время');
  if (!String(p.address || '').trim()) throw new Error('Укажите адрес');

  const st = getSettings_();
  const result = withLock_(function () {
    const q = calcQuote_(p, clientIdFromAuth);
    const blocking = q.messages.filter(function (m) { return m.type === 'error'; });
    if (blocking.length) throw new Error(blocking[0].text);
    if (!isSlotFree_(p.date, p.time, q.duration)) throw new Error('Это время только что заняли. Пожалуйста, выберите другой слот.');

    let client = clientIdFromAuth
      ? findBy_(SHEETS.CLIENTS, 'id', clientIdFromAuth)
      : upsertClient_(p, q.referrerId);
    if (q.referrerId && !client.referredBy) client = update_(SHEETS.CLIENTS, 'id', client.id, { referredBy: q.referrerId });

    const order = {
      id: nextId_('ORD', 1000), createdAt: nowStr_(), clientId: client.id,
      name: String(p.name).trim(), phone: normPhone_(p.phone), email: String(p.email).trim().toLowerCase(),
      serviceId: String(p.serviceId), serviceName: q.serviceName, propertyType: q.propertyTypeName, rooms: q.rooms,
      date: p.date, time: p.time, duration: q.duration, address: String(p.address).trim(),
      floor: parseInt(p.floor, 10) || 1, elevator: toBool_(p.elevator), pets: toBool_(p.pets),
      extras: JSON.stringify(q.extras),
      extrasText: q.extras.map(function (e) { return e.name + (e.qty > 1 ? ' ×' + e.qty : ''); }).join(', '),
      promoCode: q.promoCode, referralCode: q.referralCode, certCode: q.certCode, certUsed: q.certApplied,
      bonusUsed: q.bonusApplied, subtotal: q.subtotal, discount: q.discount, total: q.total,
      status: STATUS.NEW, employeeId: '', employeeName: '', comment: String(p.comment || '').slice(0, 1000),
      notes: '', cancelReason: '', rating: '', review: '', refunded: false, updatedAt: nowStr_()
    };
    insert_(SHEETS.ORDERS, order);

    if (q.promoCode) {
      const promo = findBy_(SHEETS.PROMO, 'code', q.promoCode);
      update_(SHEETS.PROMO, 'code', q.promoCode, { used: num_(promo.used) + 1 });
    }
    if (q.certApplied > 0) {
      const cert = findBy_(SHEETS.CERTS, 'code', q.certCode);
      const balance = num_(cert.balance) - q.certApplied;
      update_(SHEETS.CERTS, 'code', q.certCode, { balance: balance, status: balance <= 0 ? CERT_STATUS.USED : CERT_STATUS.ACTIVE });
    }
    if (q.bonusApplied > 0) addBonus_(client.id, -q.bonusApplied, 'Оплата заказа', order.id);
    return order;
  });

  notifyNewOrder_(result, st);
  return { id: result.id, total: result.total, date: result.date, time: result.time, email: result.email };
}

// ---------------------------------------------------------------------
//  ПОДАРОЧНЫЕ СЕРТИФИКАТЫ
// ---------------------------------------------------------------------

/** Заявка на покупку сертификата. Активирует его администратор после оплаты. */
function buyCertificate(p) {
  p = p || {};
  const amount = parseInt(p.amount, 10);
  if (!(amount >= 1000 && amount <= 100000)) throw new Error('Номинал — от 1 000 до 100 000');
  if (!String(p.buyerName || '').trim()) throw new Error('Укажите ваше имя');
  if (digits_(p.buyerPhone).length < 10) throw new Error('Укажите телефон');
  if (!isEmail_(p.buyerEmail)) throw new Error('Укажите email');
  if (p.recipientEmail && !isEmail_(p.recipientEmail)) throw new Error('Некорректный email получателя');
  const st = getSettings_();
  const cert = withLock_(function () {
    let code;
    do { code = 'GIFT-' + randCode_(4) + '-' + randCode_(4); } while (findBy_(SHEETS.CERTS, 'code', code));
    const c = {
      code: code, createdAt: nowStr_(), amount: amount, balance: amount, status: CERT_STATUS.PENDING,
      buyerName: String(p.buyerName).trim(), buyerPhone: normPhone_(p.buyerPhone), buyerEmail: String(p.buyerEmail).trim(),
      recipientName: String(p.recipientName || '').trim(), recipientEmail: String(p.recipientEmail || '').trim(),
      message: String(p.message || '').slice(0, 500), validTo: addDays_(today_(), 365)
    };
    insert_(SHEETS.CERTS, c);
    return c;
  });
  sendMail_(st.adminEmail, 'Заявка на сертификат ' + cert.code,
    '<p>Новая заявка на подарочный сертификат на <b>' + money_(amount, st) + '</b>.</p>' +
    '<p>Покупатель: ' + esc_(cert.buyerName) + ', ' + esc_(cert.buyerPhone) + ', ' + esc_(cert.buyerEmail) + '</p>' +
    '<p>После оплаты активируйте сертификат в CRM → Маркетинг → Сертификаты.</p>');
  sendMail_(cert.buyerEmail, 'Ваша заявка на сертификат — ' + st.companyName,
    '<p>Спасибо! Мы получили заявку на сертификат номиналом <b>' + money_(amount, st) + '</b>.</p>' +
    '<p>Менеджер свяжется с вами для оплаты. После оплаты сертификат <b>' + cert.code + '</b> будет активирован.</p>');
  return { code: cert.code, amount: amount };
}

// ---------------------------------------------------------------------
//  ЛИЧНЫЙ КАБИНЕТ КЛИЕНТА: вход по телефону или email (одноразовый код на почту)
// ---------------------------------------------------------------------

function maskEmail_(e) {
  const p = String(e).split('@');
  return p[0].slice(0, 2) + '***@' + p[1];
}

/** Шаг 1: отправить одноразовый код на email клиента */
function requestLoginCode(identifier) {
  const id = String(identifier || '').trim();
  const client = isEmail_(id) ? findClient_('', id) : findClient_(id, '');
  if (!client) throw new Error('Клиент не найден. Оформите первый заказ — кабинет создастся автоматически.');
  if (!isEmail_(client.email)) throw new Error('У вашего профиля не указан email. Позвоните нам, и мы его добавим.');
  const cache = CacheService.getScriptCache();
  if (cache.get('otp_wait_' + client.id)) throw new Error('Код уже отправлен. Повторная отправка — через минуту.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('otp_' + client.id, JSON.stringify({ code: code, tries: 0 }), 600);
  cache.put('otp_wait_' + client.id, '1', 60);
  const st = getSettings_();
  MailApp.sendEmail({
    to: client.email,
    subject: 'Код входа: ' + code + ' — ' + st.companyName,
    htmlBody: '<p>Ваш код для входа в личный кабинет:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">' + code +
      '</p><p>Код действует 10 минут. Если вы не запрашивали вход — просто проигнорируйте письмо.</p>',
    name: st.companyName
  });
  return { sentTo: maskEmail_(client.email) };
}

/** Шаг 2: проверить код и выдать токен сессии */
function verifyLoginCode(identifier, code) {
  const id = String(identifier || '').trim();
  const client = isEmail_(id) ? findClient_('', id) : findClient_(id, '');
  if (!client) throw new Error('Клиент не найден');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp_' + client.id);
  if (!raw) throw new Error('Код истёк. Запросите новый.');
  const otp = JSON.parse(raw);
  if (otp.tries >= 5) { cache.remove('otp_' + client.id); throw new Error('Слишком много попыток. Запросите новый код.'); }
  if (String(code).trim() !== otp.code) {
    otp.tries++;
    cache.put('otp_' + client.id, JSON.stringify(otp), 600);
    throw new Error('Неверный код');
  }
  cache.remove('otp_' + client.id);
  const token = Utilities.getUuid();
  cache.put('ct_' + token, String(client.id), TOKEN_TTL);
  return { token: token };
}

function logoutClient(token) { if (token) CacheService.getScriptCache().remove('ct_' + token); return true; }

function clientIdFromToken_(token, soft) {
  const id = token ? CacheService.getScriptCache().get('ct_' + token) : null;
  if (!id) { if (soft) return ''; throw new Error('AUTH: Сессия истекла, войдите снова'); }
  return id;
}

/** Данные личного кабинета */
function getAccount(token) {
  const clientId = clientIdFromToken_(token);
  const st = getSettings_();
  const client = findBy_(SHEETS.CLIENTS, 'id', clientId);
  if (!client) throw new Error('AUTH: Профиль не найден');
  const now = new Date();
  const cancelMs = num_(st.cancelHours) * 3600000;
  const orders = readAll_(SHEETS.ORDERS)
    .filter(function (o) { return String(o.clientId) === String(clientId); })
    .sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); })
    .map(function (o) {
      const editable = (o.status === STATUS.NEW || o.status === STATUS.ASSIGNED) && (orderStart_(o) - now) > cancelMs;
      let extras = [];
      try { extras = JSON.parse(o.extras || '[]'); } catch (e) { extras = []; }
      return {
        id: o.id, date: o.date, time: o.time, duration: num_(o.duration), serviceId: String(o.serviceId), serviceName: o.serviceName,
        propertyType: o.propertyType, rooms: num_(o.rooms), address: o.address, floor: o.floor, elevator: o.elevator,
        pets: o.pets, extras: extras, extrasText: o.extrasText, total: num_(o.total), status: o.status,
        employeeName: o.employeeName, rating: num_(o.rating), review: o.review, comment: o.comment,
        canCancel: editable, canReschedule: editable, canRate: o.status === STATUS.DONE && !num_(o.rating)
      };
    });
  const bonusHistory = readAll_(SHEETS.BONUS)
    .filter(function (b) { return String(b.clientId) === String(clientId); })
    .map(function (b) { return { date: b.date, amount: num_(b.amount), reason: b.reason, orderId: b.orderId }; })
    .reverse();
  const friends = readAll_(SHEETS.CLIENTS)
    .filter(function (c) { return String(c.referredBy) === String(clientId); })
    .map(function (c) {
      const rewarded = bonusHistory.some(function (b) { return b.reason === 'Приглашение друга' && String(b.orderId).endsWith('/' + c.id); });
      return { name: String(c.name || '').split(' ')[0], date: String(c.createdAt).slice(0, 10), rewarded: rewarded };
    });
  return {
    profile: { name: client.name, phone: client.phone, email: client.email, address: client.address, vip: client.vip, referralCode: client.referralCode },
    bonus: bonusBalance_(clientId),
    bonusHistory: bonusHistory,
    friends: friends,
    orders: orders
  };
}

function myOrder_(token, orderId) {
  const clientId = clientIdFromToken_(token);
  const o = findBy_(SHEETS.ORDERS, 'id', orderId);
  if (!o || String(o.clientId) !== String(clientId)) throw new Error('Заказ не найден');
  return o;
}

function assertEditable_(o) {
  const st = getSettings_();
  if (o.status !== STATUS.NEW && o.status !== STATUS.ASSIGNED) throw new Error('Заказ в статусе «' + o.status + '» нельзя изменить');
  if (orderStart_(o) - new Date() < num_(st.cancelHours) * 3600000) {
    throw new Error('До уборки меньше ' + st.cancelHours + ' ч. Пожалуйста, позвоните нам: ' + st.phone);
  }
}

function cancelMyOrder(token, orderId, reason) {
  return withLock_(function () {
    const o = myOrder_(token, orderId);
    assertEditable_(o);
    if (!String(reason || '').trim()) throw new Error('Укажите причину отмены');
    applyOrderUpdate_(o, { status: STATUS.CANCELLED, cancelReason: String(reason).slice(0, 300) });
    sendMail_(getSettings_().adminEmail, 'Клиент отменил заказ ' + o.id, '<p>Причина: ' + esc_(reason) + '</p>');
    return true;
  });
}

function rescheduleMyOrder(token, orderId, date, time) {
  return withLock_(function () {
    const o = myOrder_(token, orderId);
    assertEditable_(o);
    if (!isSlotFree_(date, time, o.duration, o.id)) throw new Error('Выбранное время занято');
    const note = (o.notes ? o.notes + '\n' : '') + nowStr_() + ': клиент перенёс с ' + o.date + ' ' + o.time;
    update_(SHEETS.ORDERS, 'id', o.id, { date: date, time: time, notes: note, updatedAt: nowStr_() });
    sendMail_(getSettings_().adminEmail, 'Перенос заказа ' + o.id, '<p>Новое время: ' + esc_(date) + ' ' + esc_(time) + '</p>');
    return true;
  });
}

function rateMyOrder(token, orderId, rating, text) {
  return withLock_(function () {
    const o = myOrder_(token, orderId);
    if (o.status !== STATUS.DONE) throw new Error('Оценить можно только завершённый заказ');
    if (num_(o.rating)) throw new Error('Вы уже оценили этот заказ');
    const r = clamp_(parseInt(rating, 10) || 0, 1, 5);
    const t = String(text || '').slice(0, 2000);
    update_(SHEETS.ORDERS, 'id', o.id, { rating: r, review: t, updatedAt: nowStr_() });
    insert_(SHEETS.REVIEWS, {
      id: nextId_('RV', 0), date: today_(), author: String(o.name).split(' ')[0], rating: r, text: t,
      source: 'Сайт', orderId: o.id, clientId: o.clientId, employeeId: o.employeeId, published: false, avatar: ''
    });
    return true;
  });
}

// ---------------------------------------------------------------------
//  ЖИЗНЕННЫЙ ЦИКЛ ЗАКАЗА: побочные эффекты смены статуса
// ---------------------------------------------------------------------

/**
 * Применяет изменения к заказу и обрабатывает побочные эффекты:
 *  - назначение сотрудника → статус «Назначен»;
 *  - «Завершён» → кэшбэк клиенту + бонус пригласившему за первый заказ друга;
 *  - «Отменён»  → возврат бонусов и остатка сертификата.
 */
function applyOrderUpdate_(order, patch) {
  const st = getSettings_();
  patch = Object.assign({}, patch);
  if ('employeeId' in patch) {
    const emp = patch.employeeId ? findBy_(SHEETS.EMPLOYEES, 'id', patch.employeeId) : null;
    patch.employeeName = emp ? emp.name : '';
    if (emp && !patch.status && order.status === STATUS.NEW) patch.status = STATUS.ASSIGNED;
  }
  patch.updatedAt = nowStr_();
  const prev = order.status;
  const updated = update_(SHEETS.ORDERS, 'id', order.id, patch);

  if (patch.status === STATUS.DONE && prev !== STATUS.DONE) {
    const bonusLog = readAll_(SHEETS.BONUS);
    const already = bonusLog.some(function (b) { return String(b.orderId) === String(order.id) && b.reason === 'Кэшбэк'; });
    if (!already && num_(st.bonusPercent) > 0) addBonus_(order.clientId, num_(updated.total) * num_(st.bonusPercent) / 100, 'Кэшбэк', order.id);
    const client = findBy_(SHEETS.CLIENTS, 'id', order.clientId);
    if (client && client.referredBy) {
      const refKey = order.id + '/' + client.id;
      const paid = bonusLog.some(function (b) { return b.reason === 'Приглашение друга' && String(b.orderId).endsWith('/' + client.id); });
      if (!paid) addBonus_(client.referredBy, num_(st.referralBonus), 'Приглашение друга', refKey);
    }
  }
  if (patch.status === STATUS.CANCELLED && prev !== STATUS.CANCELLED && !toBool_(order.refunded)) {
    if (num_(order.bonusUsed) > 0) addBonus_(order.clientId, num_(order.bonusUsed), 'Возврат за отмену', order.id);
    if (num_(order.certUsed) > 0 && order.certCode) {
      const cert = findBy_(SHEETS.CERTS, 'code', order.certCode);
      if (cert) update_(SHEETS.CERTS, 'code', cert.code, { balance: num_(cert.balance) + num_(order.certUsed), status: CERT_STATUS.ACTIVE });
    }
    update_(SHEETS.ORDERS, 'id', order.id, { refunded: true });
  }
  if (patch.status && patch.status !== prev) notifyStatus_(updated, st);
  return updated;
}

// ---------------------------------------------------------------------
//  УВЕДОМЛЕНИЯ ПО EMAIL (MailApp — бесплатно, в пределах квоты Google)
// ---------------------------------------------------------------------

function sendMail_(to, subject, html) {
  if (!to) return;
  try {
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: getSettings_().companyName });
  } catch (e) { console.warn('Mail error: ' + e); }
}

function notifyNewOrder_(o, st) {
  const details = '<table cellpadding="4">' +
    [['Заказ', o.id], ['Услуга', o.serviceName + ' · ' + o.propertyType + ', ' + o.rooms + ' комн.'],
    ['Дата и время', o.date + ' ' + o.time], ['Адрес', o.address + ', этаж ' + o.floor],
    ['Доп. услуги', o.extrasText || '—'], ['Итого', money_(o.total, st)]]
      .map(function (r) { return '<tr><td style="color:#666">' + r[0] + '</td><td><b>' + esc_(r[1]) + '</b></td></tr>'; }).join('') +
    '</table>';
  sendMail_(st.adminEmail, '🧽 Новый заказ ' + o.id + ' — ' + o.date + ' ' + o.time,
    details + '<p>Клиент: ' + esc_(o.name) + ', ' + esc_(o.phone) + ', ' + esc_(o.email) + '</p><p>Комментарий: ' + esc_(o.comment || '—') + '</p>');
  sendMail_(o.email, 'Заявка ' + o.id + ' принята — ' + st.companyName,
    '<p>Здравствуйте, ' + esc_(o.name) + '!</p><p>Мы получили вашу заявку и скоро подтвердим её.</p>' + details +
    '<p>Следить за заказом можно в личном кабинете на сайте. Вопросы: ' + esc_(st.phone) + '</p>');
}

function notifyStatus_(o, st) {
  const text = {};
  text[STATUS.ASSIGNED] = 'Заказ подтверждён' + (o.employeeName ? ', к вам приедет ' + esc_(o.employeeName) : '') + '.';
  text[STATUS.DONE] = 'Уборка завершена. Будем благодарны за оценку в личном кабинете!';
  text[STATUS.CANCELLED] = 'Заказ отменён.' + (o.cancelReason ? ' Причина: ' + esc_(o.cancelReason) : '');
  if (!text[o.status]) return;
  sendMail_(o.email, 'Заказ ' + o.id + ': ' + o.status, '<p>' + text[o.status] + '</p><p>' + esc_(o.date) + ' ' + esc_(o.time) + ', ' + esc_(o.address) + '</p>');
}

// =====================================================================
//  АДМИНКА (CRM)
// =====================================================================

/** Данные для загрузки страницы CRM: если Google-аккаунт в списке админов — входим без пароля */
function adminBoot_() {
  const st = getSettings_();
  let email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) { email = ''; }
  const allowed = String(st.adminEmails || '').toLowerCase().split(/[,;\s]+/).filter(String);
  let token = '';
  if (email && allowed.indexOf(email.toLowerCase()) >= 0) token = issueAdminToken_(email);
  return { companyName: st.companyName, currency: st.currency, token: token, email: email, statuses: STATUS_LIST };
}

function issueAdminToken_(who) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('at_' + token, who || 'admin', TOKEN_TTL);
  return token;
}

/** Вход в CRM по паролю (хэш хранится в Script Properties) */
function adminLogin(password) {
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= 10) throw new Error('Слишком много попыток. Подождите 10 минут.');
  const hash = props.getProperty('ADMIN_PASSWORD_HASH');
  if (!hash) throw new Error('Пароль не задан. Запустите setup() в редакторе скриптов.');
  if (sha256_(String(password || '')) !== hash) {
    cache.put('admin_fails', String(fails + 1), 600);
    throw new Error('Неверный пароль');
  }
  return { token: issueAdminToken_('password') };
}

function assertAdmin_(token) {
  if (!token || !CacheService.getScriptCache().get('at_' + token)) throw new Error('AUTH: Сессия истекла, войдите снова');
}

/** Таблицы, доступные для универсального CRUD из админки, и их ключевое поле */
const CRUD_TABLES = {
  services: { sheet: SHEETS.SERVICES, key: 'id', prefix: 'S' },
  employees: { sheet: SHEETS.EMPLOYEES, key: 'id', prefix: 'E' },
  promos: { sheet: SHEETS.PROMO, key: 'code' },
  reviews: { sheet: SHEETS.REVIEWS, key: 'id', prefix: 'RV' },
  certs: { sheet: SHEETS.CERTS, key: 'code' },
  content: { sheet: SHEETS.CONTENT, key: 'id', prefix: 'C' }
};

/**
 * Единая точка входа API админки: adminApi(token, action, data).
 * Каждое действие проверяет токен.
 */
function adminApi(token, action, data) {
  assertAdmin_(token);
  data = data || {};
  switch (action) {
    case 'dashboard': return adminDashboard_();
    case 'orders.list': return adminOrders_(data);
    case 'orders.update': return withLock_(function () {
      const o = findBy_(SHEETS.ORDERS, 'id', data.id);
      if (!o) throw new Error('Заказ не найден');
      const allowed = ['status', 'employeeId', 'notes', 'cancelReason', 'date', 'time', 'total', 'duration', 'address'];
      const patch = {};
      allowed.forEach(function (k) { if (k in data.patch) patch[k] = data.patch[k]; });
      if (patch.status && STATUS_LIST.indexOf(patch.status) < 0) throw new Error('Неизвестный статус');
      return strip_(applyOrderUpdate_(o, patch));
    });
    case 'orders.export': return exportOrders_(data.from, data.to);
    case 'clients.list': return adminClients_();
    case 'clients.update': return withLock_(function () {
      const patch = {};
      ['name', 'phone', 'email', 'address', 'vip', 'notes'].forEach(function (k) { if (k in data.patch) patch[k] = data.patch[k]; });
      if (patch.phone) patch.phone = normPhone_(patch.phone);
      return strip_(update_(SHEETS.CLIENTS, 'id', data.id, patch));
    });
    case 'clients.bonus': return withLock_(function () {
      addBonus_(data.id, num_(data.amount), data.reason || 'Ручное начисление', '');
      return bonusBalance_(data.id);
    });
    case 'employees.list': return adminEmployees_(data);
    case 'referrals': return adminReferrals_();
    case 'reports': return adminReports_(data.from, data.to);
    case 'settings.get': return getSettingsTable_();
    case 'settings.save': return withLock_(function () { saveSettings_(data.values || {}); return true; });
    case 'password.change': return changeAdminPassword_(data.current, data.next);
    case 'crud.list': return crudList_(data.table);
    case 'crud.save': return withLock_(function () { return crudSave_(data.table, data.item, data.isNew); });
    case 'crud.delete': return withLock_(function () { const t = crudTable_(data.table); remove_(t.sheet, t.key, data.id); return true; });
    case 'certs.activate': return withLock_(function () {
      const c = update_(SHEETS.CERTS, 'code', data.code, { status: CERT_STATUS.ACTIVE });
      const st = getSettings_();
      const to = c.recipientEmail || c.buyerEmail;
      sendMail_(to, '🎁 Подарочный сертификат ' + st.companyName,
        '<p>' + (c.recipientName ? esc_(c.recipientName) + ', в' : 'В') + 'ам подарили уборку!</p>' +
        '<p style="font-size:22px"><b>' + c.code + '</b> — ' + money_(c.amount, st) + '</p>' +
        (c.message ? '<p><i>«' + esc_(c.message) + '»</i></p>' : '') +
        '<p>Введите код при онлайн-записи на сайте. Действует до ' + esc_(c.validTo) + '.</p>');
      return strip_(c);
    });
    default: throw new Error('Неизвестное действие: ' + action);
  }
}

function crudTable_(name) {
  const t = CRUD_TABLES[name];
  if (!t) throw new Error('Таблица недоступна');
  return t;
}

function crudList_(name) {
  const t = crudTable_(name);
  return readAll_(t.sheet).map(strip_);
}

function crudSave_(name, item, isNew) {
  const t = crudTable_(name);
  item = Object.assign({}, item);
  delete item._row;
  const keys = SCHEMA[t.sheet].map(function (p) { return p[0]; });
  const clean = {};
  keys.forEach(function (k) { if (k in item) clean[k] = item[k]; });
  if (t.key === 'code') clean.code = String(clean.code || '').trim().toUpperCase();
  if (isNew) {
    if (!clean[t.key]) {
      if (!t.prefix) throw new Error('Укажите код');
      clean[t.key] = nextId_(t.prefix, 0);
    }
    if (findBy_(t.sheet, t.key, clean[t.key])) throw new Error('Запись с таким ключом уже существует');
    if (name === 'certs' && !clean.createdAt) clean.createdAt = nowStr_();
    insert_(t.sheet, clean);
    return clean;
  }
  return strip_(update_(t.sheet, t.key, clean[t.key], clean));
}

function getSettingsTable_() {
  const st = getSettings_();
  const desc = {};
  DEFAULT_SETTINGS.forEach(function (d) { desc[d[0]] = d[2]; });
  readAll_(SHEETS.SETTINGS).forEach(function (r) { if (r.description) desc[r.key] = r.description; });
  return Object.keys(st).map(function (k) { return { key: k, value: st[k], description: desc[k] || '' }; });
}

function changeAdminPassword_(current, next) {
  const props = PropertiesService.getScriptProperties();
  if (sha256_(String(current || '')) !== props.getProperty('ADMIN_PASSWORD_HASH')) throw new Error('Текущий пароль неверен');
  if (String(next || '').length < 8) throw new Error('Новый пароль — минимум 8 символов');
  props.setProperty('ADMIN_PASSWORD_HASH', sha256_(String(next)));
  return true;
}

/** Смена пароля из меню таблицы */
function promptAdminPassword() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Новый пароль для CRM (минимум 8 символов):');
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pwd = r.getResponseText();
  if (pwd.length < 8) { ui.alert('Слишком короткий пароль'); return; }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD_HASH', sha256_(pwd));
  ui.alert('Пароль обновлён');
}

// ---------------------------------------------------------------------
//  ДАШБОРД
// ---------------------------------------------------------------------

function adminDashboard_() {
  const orders = readAll_(SHEETS.ORDERS);
  const clients = readAll_(SHEETS.CLIENTS);
  const t = today_();
  const d7 = addDays_(t, -6), d30 = addDays_(t, -29);
  const monthStart = t.slice(0, 8) + '01';
  const done = orders.filter(function (o) { return o.status === STATUS.DONE; });
  const sumIn = function (from, to) {
    return done.filter(function (o) { return o.date >= from && o.date <= to; }).reduce(function (a, o) { return a + num_(o.total); }, 0);
  };

  // Ряды выручки: по дням (30), неделям (12), месяцам (12)
  const byDay = [];
  for (let i = 29; i >= 0; i--) { const d = addDays_(t, -i); byDay.push({ label: d.slice(8) + '.' + d.slice(5, 7), value: sumIn(d, d) }); }
  const byWeek = [];
  const dow = (parseDate_(t).getDay() + 6) % 7; // 0 = понедельник
  const weekStart = addDays_(t, -dow);
  for (let i = 11; i >= 0; i--) {
    const ws = addDays_(weekStart, -7 * i), we = addDays_(ws, 6);
    byWeek.push({ label: ws.slice(8) + '.' + ws.slice(5, 7), value: sumIn(ws, we) });
  }
  const byMonth = [];
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const cur = parseDate_(monthStart);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
    const from = fmt_(d), to = fmt_(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    byMonth.push({ label: months[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2), value: sumIn(from, to) });
  }

  // Загруженность: заказы на ближайшие 14 дней + по дням недели за 90 дней
  const active = orders.filter(function (o) { return o.status !== STATUS.CANCELLED; });
  const upcoming = [];
  const wd = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  for (let i = 0; i < 14; i++) {
    const d = addDays_(t, i);
    upcoming.push({ label: wd[parseDate_(d).getDay()] + ' ' + d.slice(8), value: active.filter(function (o) { return o.date === d; }).length });
  }
  const weekdayLoad = [1, 2, 3, 4, 5, 6, 0].map(function (n) {
    return { label: wd[n], value: active.filter(function (o) { return o.date >= addDays_(t, -90) && o.date <= t && parseDate_(o.date).getDay() === n; }).length };
  });

  // Топ-5 услуг
  const svc = {};
  active.forEach(function (o) {
    svc[o.serviceName] = (svc[o.serviceName] || 0) + 1;
    String(o.extrasText || '').split(',').map(function (s) { return s.replace(/×\d+/, '').trim(); }).filter(String)
      .forEach(function (n) { svc[n] = (svc[n] || 0) + 1; });
  });
  const topServices = Object.keys(svc).map(function (k) { return { label: k, value: svc[k] }; })
    .sort(function (a, b) { return b.value - a.value; }).slice(0, 5);

  const in30 = orders.filter(function (o) { return String(o.createdAt).slice(0, 10) >= d30; });
  return {
    kpi: {
      revenueToday: sumIn(t, t), revenueWeek: sumIn(d7, t), revenueMonth: sumIn(monthStart, t),
      orders30: in30.length,
      newClients30: clients.filter(function (c) { return String(c.createdAt).slice(0, 10) >= d30; }).length,
      cancelled30: in30.filter(function (o) { return o.status === STATUS.CANCELLED; }).length,
      pending: orders.filter(function (o) { return o.status === STATUS.NEW; }).length,
      avgCheck: done.length ? Math.round(done.reduce(function (a, o) { return a + num_(o.total); }, 0) / done.length) : 0
    },
    revenue: { day: byDay, week: byWeek, month: byMonth },
    upcoming: upcoming, weekdayLoad: weekdayLoad, topServices: topServices,
    todayOrders: orders.filter(function (o) { return o.date === t && o.status !== STATUS.CANCELLED; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); }).map(strip_)
  };
}

// ---------------------------------------------------------------------
//  ЗАКАЗЫ
// ---------------------------------------------------------------------

function adminOrders_(f) {
  const q = String(f.search || '').trim().toLowerCase();
  const orders = readAll_(SHEETS.ORDERS).filter(function (o) {
    if (f.status && o.status !== f.status) return false;
    if (f.from && o.date < f.from) return false;
    if (f.to && o.date > f.to) return false;
    if (f.employeeId === '__none' && o.employeeId) return false;
    if (f.employeeId && f.employeeId !== '__none' && String(o.employeeId) !== String(f.employeeId)) return false;
    if (f.serviceId && String(o.serviceId) !== String(f.serviceId)) return false;
    if (f.clientId && String(o.clientId) !== String(f.clientId)) return false;
    if (q && [o.id, o.name, o.phone, o.email, o.address].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
  return {
    orders: orders.map(strip_),
    employees: readAll_(SHEETS.EMPLOYEES).map(function (e) { return { id: String(e.id), name: e.name, active: e.active }; }),
    services: readAll_(SHEETS.SERVICES).filter(function (s) { return s.kind === KIND_MAIN; }).map(function (s) { return { id: String(s.id), name: s.name }; })
  };
}

/** Экспорт заказов за период в новую Google-таблицу */
function exportOrders_(from, to) {
  from = from || '0000-00-00'; to = to || '9999-12-31';
  const orders = readAll_(SHEETS.ORDERS).filter(function (o) { return o.date >= from && o.date <= to; })
    .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
  const cols = SCHEMA[SHEETS.ORDERS].filter(function (p) { return p[0] !== 'extras'; });
  const file = SpreadsheetApp.create('Заказы ' + from + ' — ' + to + ' (' + getSettings_().companyName + ')');
  const sh = file.getSheets()[0];
  sh.setName('Заказы');
  const rows = [cols.map(function (p) { return p[1]; })].concat(orders.map(function (o) {
    return cols.map(function (p) { const v = o[p[0]]; return v === undefined ? '' : cell_(p[0], v); });
  }));
  sh.getRange(1, 1, rows.length, cols.length).setValues(rows);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#e8f5f1');
  sh.setFrozenRows(1);
  const total = orders.filter(function (o) { return o.status === STATUS.DONE; }).reduce(function (a, o) { return a + num_(o.total); }, 0);
  sh.getRange(rows.length + 2, 1, 1, 2).setValues([['Выручка (завершённые)', total]]).setFontWeight('bold');
  return { url: file.getUrl(), count: orders.length };
}

// ---------------------------------------------------------------------
//  КЛИЕНТЫ (CRM)
// ---------------------------------------------------------------------

function adminClients_() {
  const orders = readAll_(SHEETS.ORDERS);
  const bonus = readAll_(SHEETS.BONUS);
  const all = readAll_(SHEETS.CLIENTS);
  const names = {};
  all.forEach(function (c) { names[c.id] = c.name; });
  const t = today_();
  return all.map(function (c) {
    const own = orders.filter(function (o) { return String(o.clientId) === String(c.id); });
    const done = own.filter(function (o) { return o.status === STATUS.DONE; });
    const active = own.filter(function (o) { return o.status !== STATUS.CANCELLED; });
    const last = active.map(function (o) { return o.date; }).filter(function (d) { return d <= t; }).sort().pop() || '';
    const next = active.filter(function (o) { return o.date > t; }).map(function (o) { return o.date; }).sort()[0] || '';
    return Object.assign(strip_(c), {
      ordersCount: active.length,
      doneCount: done.length,
      cancelledCount: own.length - active.length,
      ltv: done.reduce(function (a, o) { return a + num_(o.total); }, 0),
      lastOrder: last,
      nextOrder: next,
      daysSince: last ? daysBetween_(last, t) : null,
      bonus: bonus.filter(function (b) { return String(b.clientId) === String(c.id); }).reduce(function (a, b) { return a + num_(b.amount); }, 0),
      referredByName: c.referredBy ? (names[c.referredBy] || c.referredBy) : ''
    });
  });
}

function adminReferrals_() {
  const clients = adminClients_();
  const byId = {};
  clients.forEach(function (c) { byId[c.id] = c; });
  const bonus = readAll_(SHEETS.BONUS).filter(function (b) { return b.reason === 'Приглашение друга'; });
  const rows = clients.filter(function (c) { return c.referredBy; }).map(function (c) {
    const ref = byId[c.referredBy] || {};
    const paid = bonus.filter(function (b) { return String(b.orderId).endsWith('/' + c.id); }).reduce(function (a, b) { return a + num_(b.amount); }, 0);
    return { referrerId: c.referredBy, referrerName: ref.name || c.referredBy, friendId: c.id, friendName: c.name, date: String(c.createdAt).slice(0, 10), friendOrders: c.doneCount, friendLtv: c.ltv, bonusPaid: paid };
  });
  const leaders = {};
  rows.forEach(function (r) {
    const l = leaders[r.referrerId] = leaders[r.referrerId] || { name: r.referrerName, invited: 0, converted: 0, revenue: 0 };
    l.invited++; if (r.friendOrders > 0) l.converted++; l.revenue += r.friendLtv;
  });
  return { rows: rows, leaders: Object.keys(leaders).map(function (k) { return leaders[k]; }).sort(function (a, b) { return b.invited - a.invited; }) };
}

// ---------------------------------------------------------------------
//  СОТРУДНИКИ: расписание и статистика
// ---------------------------------------------------------------------

function adminEmployees_(f) {
  const orders = readAll_(SHEETS.ORDERS);
  const from = f.from || today_(), to = f.to || addDays_(today_(), 6);
  return readAll_(SHEETS.EMPLOYEES).map(function (e) {
    const own = orders.filter(function (o) { return String(o.employeeId) === String(e.id); });
    const done = own.filter(function (o) { return o.status === STATUS.DONE; });
    const rated = done.filter(function (o) { return num_(o.rating) > 0; });
    const month = done.filter(function (o) { return o.date >= today_().slice(0, 8) + '01'; });
    return Object.assign(strip_(e), {
      stats: {
        done: done.length,
        doneMonth: month.length,
        revenue: done.reduce(function (a, o) { return a + num_(o.total); }, 0),
        hours: done.reduce(function (a, o) { return a + num_(o.duration); }, 0),
        avgRating: rated.length ? Math.round(rated.reduce(function (a, o) { return a + num_(o.rating); }, 0) / rated.length * 10) / 10 : null,
        ratings: rated.length
      },
      schedule: own.filter(function (o) { return o.date >= from && o.date <= to && o.status !== STATUS.CANCELLED; })
        .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })
        .map(function (o) { return { id: o.id, date: o.date, time: o.time, duration: num_(o.duration), serviceName: o.serviceName, address: o.address, status: o.status, name: o.name }; })
    });
  });
}

// ---------------------------------------------------------------------
//  ОТЧЁТЫ
// ---------------------------------------------------------------------

function adminReports_(from, to) {
  to = to || today_();
  from = from || addDays_(to, -89);
  const all = readAll_(SHEETS.ORDERS);
  const inRange = all.filter(function (o) { return o.date >= from && o.date <= to; });
  const done = inRange.filter(function (o) { return o.status === STATUS.DONE; });
  const cancelled = inRange.filter(function (o) { return o.status === STATUS.CANCELLED; });

  // Выручка по периодам: по дням (до 62 дней), по неделям (до 26 недель) или по месяцам
  const span = daysBetween_(from, to);
  const gran = span <= 62 ? 'day' : span <= 182 ? 'week' : 'month';
  const bucket = function (d) {
    if (gran === 'day') return d;
    if (gran === 'month') return d.slice(0, 7);
    const dt = parseDate_(d); return addDays_(d, -((dt.getDay() + 6) % 7));
  };
  const periods = {};
  for (let d = from; d <= to; d = addDays_(d, 1)) periods[bucket(d)] = { label: bucket(d), revenue: 0, orders: 0 };
  done.forEach(function (o) { const b = periods[bucket(o.date)]; if (b) { b.revenue += num_(o.total); b.orders++; } });

  const group = function (arr, keyFn) {
    const m = {};
    arr.forEach(function (o) {
      const k = keyFn(o) || '—';
      const g = m[k] = m[k] || { label: k, orders: 0, revenue: 0, ratingSum: 0, ratingCnt: 0 };
      g.orders++; g.revenue += num_(o.total);
      if (num_(o.rating)) { g.ratingSum += num_(o.rating); g.ratingCnt++; }
    });
    return Object.keys(m).map(function (k) {
      const g = m[k];
      return { label: g.label, orders: g.orders, revenue: g.revenue, avgCheck: Math.round(g.revenue / g.orders), avgRating: g.ratingCnt ? Math.round(g.ratingSum / g.ratingCnt * 10) / 10 : null };
    }).sort(function (a, b) { return b.revenue - a.revenue; });
  };

  // Отмены: причины, доля, по дням недели
  const reasons = {};
  cancelled.forEach(function (o) { const r = String(o.cancelReason || 'Без причины').trim(); reasons[r] = (reasons[r] || 0) + 1; });
  const wd = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const cancelByWeekday = [1, 2, 3, 4, 5, 6, 0].map(function (n) {
    return { label: wd[n], value: cancelled.filter(function (o) { return parseDate_(o.date).getDay() === n; }).length };
  });

  // Среднее время между заказами (по клиентам с 2+ заказами, вся история)
  const byClient = {};
  all.filter(function (o) { return o.status !== STATUS.CANCELLED; }).forEach(function (o) { (byClient[o.clientId] = byClient[o.clientId] || []).push(o.date); });
  const gaps = [];
  const perClient = [];
  Object.keys(byClient).forEach(function (cid) {
    const ds = byClient[cid].sort();
    if (ds.length < 2) return;
    const g = [];
    for (let i = 1; i < ds.length; i++) g.push(daysBetween_(ds[i - 1], ds[i]));
    gaps.push.apply(gaps, g);
    perClient.push({ clientId: cid, orders: ds.length, avgGap: Math.round(g.reduce(function (a, b) { return a + b; }, 0) / g.length) });
  });
  const buckets = [['до 14 дн.', 0, 14], ['15–30', 15, 30], ['31–60', 31, 60], ['61–90', 61, 90], ['90+', 91, 1e9]]
    .map(function (b) { return { label: b[0], value: gaps.filter(function (g) { return g >= b[1] && g <= b[2]; }).length }; });
  const names = {};
  readAll_(SHEETS.CLIENTS).forEach(function (c) { names[c.id] = c.name; });
  perClient.forEach(function (p) { p.name = names[p.clientId] || p.clientId; });

  return {
    from: from, to: to, granularity: gran,
    totals: {
      revenue: done.reduce(function (a, o) { return a + num_(o.total); }, 0),
      orders: inRange.length, done: done.length, cancelled: cancelled.length,
      cancelRate: inRange.length ? Math.round(cancelled.length / inRange.length * 1000) / 10 : 0,
      avgCheck: done.length ? Math.round(done.reduce(function (a, o) { return a + num_(o.total); }, 0) / done.length) : 0,
      discounts: done.reduce(function (a, o) { return a + num_(o.discount); }, 0)
    },
    periods: Object.keys(periods).sort().map(function (k) { return periods[k]; }),
    byService: group(done, function (o) { return o.serviceName; }),
    byEmployee: group(done, function (o) { return o.employeeName || 'Не назначен'; }),
    cancellations: {
      reasons: Object.keys(reasons).map(function (k) { return { label: k, value: reasons[k] }; }).sort(function (a, b) { return b.value - a.value; }),
      byWeekday: cancelByWeekday,
      lateCount: cancelled.filter(function (o) { return o.updatedAt && orderStart_(o) - new Date(String(o.updatedAt).replace(' ', 'T')) < 24 * 3600000; }).length
    },
    repeat: {
      avgGap: gaps.length ? Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null,
      medianGap: gaps.length ? gaps.slice().sort(function (a, b) { return a - b; })[Math.floor(gaps.length / 2)] : null,
      repeatClients: perClient.length,
      totalClients: Object.keys(byClient).length,
      distribution: buckets,
      top: perClient.sort(function (a, b) { return b.orders - a.orders; }).slice(0, 10)
    }
  };
}

// =====================================================================
//  ПЕРВИЧНАЯ НАСТРОЙКА И ДЕМО-ДАННЫЕ
// =====================================================================

/**
 * Создаёт все листы с заголовками и наполняет стартовыми данными.
 * Безопасно запускать повторно: существующие листы и данные не трогаются.
 */
function setup() {
  const ss = ss_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  Object.keys(SCHEMA).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    const cols = SCHEMA[name];
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      cols.forEach(function (c, i) {
        const range = sh.getRange(2, i + 1, 999, 1);
        if (TEXT_KEYS[c[0]]) range.setNumberFormat('@');
        // Галочки: Sheets хранит в них FALSE даже в пустых строках — см. isBlankRow_ и insert_
        if (BOOL_KEYS[c[0]]) range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      });
      if (name === SHEETS.ORDERS) {
        const stCol = cols.findIndex(function (c) { return c[0] === 'status'; }) + 1;
        sh.getRange(2, stCol, 999, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).build());
      }
      seed_(name);
    }
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSWORD_HASH')) {
    props.setProperty('ADMIN_PASSWORD_HASH', sha256_('admin12345'));
    console.log('Пароль админки по умолчанию: admin12345 — смените его в CRM → Настройки!');
  }
  return 'Готово! Пароль CRM по умолчанию: admin12345';
}

/** Стартовые данные для нового листа */
function seed_(name) {
  const rows = {};
  rows[SHEETS.SETTINGS] = DEFAULT_SETTINGS.map(function (d) { return { key: d[0], value: d[1], description: d[2] }; });

  rows[SHEETS.SERVICES] = [
    { id: 'S1', active: true, kind: KIND_MAIN, name: 'Стандартная уборка', icon: '✨', short: 'Поддерживающая уборка для регулярной чистоты',
      description: 'Идеально, чтобы поддерживать порядок каждую неделю: пыль, полы, кухня и санузел.',
      basePrice: 1500, perRoom: 500, unit: 'заказ', baseHours: 1.5, perRoomHours: 0.7,
      includes: 'Влажная уборка полов и плинтусов; Удаление пыли с доступных поверхностей; Уборка кухонных фасадов и столешниц; Мытьё плиты снаружи; Уборка санузла и ванной; Чистка зеркал; Вынос мусора; Заправка кровати',
      paidExtras: 'Мытьё окон; Чистка духовки и холодильника внутри; Глажка белья; Уборка балкона',
      excludes: 'Мытьё стен и потолков; Удаление плесени; Химчистка мебели', sort: 1 },
    { id: 'S2', active: true, kind: KIND_MAIN, name: 'Генеральная уборка', icon: '🧽', short: 'Глубокая уборка каждого уголка',
      description: 'Тщательная уборка всех поверхностей, включая труднодоступные места, мебель внутри и снаружи.',
      basePrice: 3000, perRoom: 1000, unit: 'заказ', baseHours: 3, perRoomHours: 1.5,
      includes: 'Всё из стандартной уборки; Мытьё мебели внутри и снаружи; Чистка радиаторов и вентиляционных решёток; Мытьё дверей и выключателей; Удаление известкового налёта; Мытьё кухонной техники снаружи; Уборка под мебелью; Мытьё люстр и светильников',
      paidExtras: 'Мытьё окон; Чистка духовки внутри; Химчистка дивана; Мытьё балкона',
      excludes: 'Вынос строительного мусора; Мытьё фасадов', sort: 2 },
    { id: 'S3', active: true, kind: KIND_MAIN, name: 'Уборка после ремонта', icon: '🛠️', short: 'Удалим строительную пыль и следы ремонта',
      description: 'Профессиональные средства и оборудование для удаления строительной пыли, краски, затирки и клея.',
      basePrice: 4500, perRoom: 1500, unit: 'заказ', baseHours: 4, perRoomHours: 2,
      includes: 'Удаление строительной пыли со всех поверхностей; Отмывание следов краски, клея, затирки; Мытьё окон и рам; Мытьё радиаторов и труб; Чистка сантехники от загрязнений; Мытьё дверей, плинтусов, розеток; Пылесос промышленным пылесосом',
      paidExtras: 'Вывоз строительного мусора; Мытьё фасадного остекления; Удаление цементного налёта со стен',
      excludes: 'Демонтаж; Высотные работы выше 3 м', sort: 3 },
    { id: 'X1', active: true, kind: KIND_EXTRA, name: 'Мытьё окон', icon: '🪟', short: 'Створка с двух сторон', basePrice: 200, unit: 'створка', baseHours: 0.25, sort: 10 },
    { id: 'X2', active: true, kind: KIND_EXTRA, name: 'Глажка белья', icon: '👕', short: 'Час работы', basePrice: 400, unit: 'час', baseHours: 1, sort: 11 },
    { id: 'X3', active: true, kind: KIND_EXTRA, name: 'Холодильник внутри', icon: '🧊', short: 'Мытьё полок и камеры', basePrice: 500, unit: 'шт', baseHours: 0.5, sort: 12 },
    { id: 'X4', active: true, kind: KIND_EXTRA, name: 'Духовка внутри', icon: '🔥', short: 'Удаление нагара', basePrice: 500, unit: 'шт', baseHours: 0.5, sort: 13 },
    { id: 'X5', active: true, kind: KIND_EXTRA, name: 'Уборка балкона', icon: '🌿', short: 'Пол, подоконник, остекление изнутри', basePrice: 800, unit: 'шт', baseHours: 1, sort: 14 },
    { id: 'X6', active: true, kind: KIND_EXTRA, name: 'Кухонные шкафы внутри', icon: '🗄️', short: 'Протрём каждую полку', basePrice: 500, unit: 'комплект', baseHours: 0.7, sort: 15 },
    { id: 'X7', active: true, kind: KIND_EXTRA, name: 'Микроволновка внутри', icon: '📦', short: 'Отмоем от жира', basePrice: 300, unit: 'шт', baseHours: 0.25, sort: 16 }
  ];

  rows[SHEETS.EMPLOYEES] = [
    { id: 'E1', active: true, name: 'Айгерим Токтогулова', role: 'Старший клинер', phone: '+996700000001', bio: '6 лет опыта, отвечает за качество', workDays: '1,2,3,4,5', workFrom: '08:00', workTo: '20:00', showOnSite: true },
    { id: 'E2', active: true, name: 'Бермет Жумабекова', role: 'Клинер', phone: '+996700000002', bio: 'Специалист по генеральной уборке', workDays: '1,2,3,4,6', workFrom: '08:00', workTo: '20:00', showOnSite: true },
    { id: 'E3', active: true, name: 'Нурлан Асанов', role: 'Клинер', phone: '+996700000003', bio: 'Уборка после ремонта, работа с техникой', workDays: '2,3,4,5,6', workFrom: '09:00', workTo: '21:00', showOnSite: true },
    { id: 'E4', active: true, name: 'Айпери Исакова', role: 'Менеджер по качеству', phone: '+996700000004', bio: 'Проверяет каждый заказ и собирает отзывы', workDays: '1,2,3,4,5', workFrom: '09:00', workTo: '18:00', showOnSite: true }
  ];

  // Примеры отзывов. Замените их реальными отзывами из Google Maps (источник «Google»).
  rows[SHEETS.REVIEWS] = [
    ['Жылдыз Т.', 5, 'Заказывала генеральную уборку перед праздниками — квартира сияет! Ребята приехали вовремя, всё аккуратно, даже за холодильником помыли.'],
    ['Эрлан М.', 5, 'Пользуюсь уже полгода раз в неделю. Стабильное качество, удобная запись, вежливые клинеры.'],
    ['Гульнара С.', 5, 'После ремонта думала, что неделю буду отмывать пыль. Справились за день, результат отличный.'],
    ['Бакыт А.', 4, 'Хорошая уборка офиса, всё по чек-листу. Немного задержались, но предупредили заранее.'],
    ['Айжан К.', 5, 'Очень понравилось, что цена фиксированная и известна заранее. Без сюрпризов.'],
    ['Тимур О.', 5, 'Взяли сертификат маме в подарок — она в восторге. Спасибо за внимание к деталям!']
  ].map(function (r, i) { return { id: 'RV' + (i + 1), date: addDays_(today_(), -(i * 9 + 3)), author: r[0], rating: r[1], text: r[2], source: 'Google', published: true }; });
  PropertiesService.getScriptProperties().setProperty('SEQ_RV', '6');

  rows[SHEETS.PROMO] = [
    { code: 'WELCOME10', active: true, type: '%', value: 10, minOrder: 0, validFrom: '', validTo: '', maxUses: 0, used: 0, description: 'Скидка 10% на первый заказ' },
    { code: 'CLEAN300', active: true, type: 'сом', value: 300, minOrder: 4000, validFrom: '', validTo: addDays_(today_(), 90), maxUses: 100, used: 0, description: '300 сом при заказе от 4000 сом' }
  ];

  const c = [];
  const add = function (section, title, text, image, image2) { c.push({ id: 'C' + (c.length + 1), section: section, title: title, text: text || '', image: image || '', image2: image2 || '', sort: c.length + 1, active: true }); };
  add('step', 'Заявка', 'Оставьте заявку на сайте за 1 минуту — стоимость видна сразу');
  add('step', 'Подтверждение', 'Менеджер подтвердит время и назначит проверенного клинера');
  add('step', 'Уборка', 'Приезжаем со своими средствами и инвентарём точно в срок');
  add('step', 'Отчёт', 'Присылаем фотоотчёт, вы оцениваете работу в личном кабинете');
  ['Ленинский район', 'Октябрьский район', 'Первомайский район', 'Свердловский район', 'Джал', 'Асанбай', 'Восток-5', 'Тунгуч', 'Кок-Жар', 'Арча-Бешик', 'Пригородные сёла Чуйской области (до 15 км)']
    .forEach(function (z) { add('zone', z, ''); });
  add('faq', 'Нужно ли мне быть дома во время уборки?', 'Не обязательно. Можно оставить ключи консьержу или встретить клинера и уйти по делам — многие клиенты так и делают.');
  add('faq', 'Ваши средства безопасны для детей и животных?', 'Да, мы используем сертифицированные гипоаллергенные экосредства. Если у вас есть особые пожелания — напишите в комментарии.');
  add('faq', 'Что, если меня не устроит качество?', 'Сообщите в течение 24 часов — бесплатно приедем и исправим всё, что вас не устроило.');
  add('faq', 'Как формируется цена?', 'Стоимость зависит от типа помещения, количества комнат и типа уборки. Цена фиксируется при заказе и не меняется на месте.');
  add('faq', 'Как отменить или перенести заказ?', 'В личном кабинете — бесплатно, если до уборки больше 12 часов. Позже — позвоните нам.');
  add('faq', 'Как оплатить?', 'Наличными или переводом клинеру после уборки, а также подарочным сертификатом и бонусами.');
  add('gallery', 'Кухня после генеральной уборки', '', '', '');
  add('gallery', 'Ванная: известковый налёт', '', '', '');
  add('gallery', 'Гостиная после ремонта', '', '', '');
  rows[SHEETS.CONTENT] = c;
  PropertiesService.getScriptProperties().setProperty('SEQ_C', String(c.length));

  (rows[name] || []).forEach(function (r) { insert_(name, r); });
}

/** Генерация демо-заказов и клиентов, чтобы посмотреть дашборд и отчёты */
function seedDemoOrders() {
  // Пары «имя, фамилия» подобраны с учётом рода
  const people = [['Айгуль', 'Садыкова'], ['Азамат', 'Касымов'], ['Нургуль', 'Абдыкадырова'], ['Бакыт', 'Осмонов'], ['Чолпон', 'Бейшенова'],
    ['Эрмек', 'Токтосунов'], ['Асель', 'Мамытова'], ['Улан', 'Жээнбеков'], ['Динара', 'Алиева'], ['Тилек', 'Сатыбалдиев'],
    ['Айдай', 'Курманбекова'], ['Мирлан', 'Эсенгулов'], ['Назира', 'Орозбаева'], ['Канат', 'Абдраимов'], ['Сезим', 'Шаршеева']];
  const streets = ['ул. Токтогула', 'пр. Манаса', 'ул. Киевская', 'пр. Чуй', 'ул. Ахунбаева', 'мкр. Джал', 'ул. Исанова'];
  const reasons = ['Изменились планы', 'Нашли другого исполнителя', 'Заболел', 'Перенос на другую дату', 'Дорого'];
  const svc = readAll_(SHEETS.SERVICES).filter(function (s) { return s.kind === KIND_MAIN; });
  const extras = readAll_(SHEETS.SERVICES).filter(function (s) { return s.kind === KIND_EXTRA; });
  const emps = readAll_(SHEETS.EMPLOYEES);
  const pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  const types = ['flat', 'flat', 'flat', 'house', 'office'];

  withLock_(function () {
    const clients = [];
    for (let i = 0; i < 25; i++) {
      const c = {
        id: nextId_('CL', 1000), createdAt: addDays_(today_(), -Math.floor(Math.random() * 150)) + ' 10:00',
        name: pick(people).join(' '), phone: '+996' + pick(['555', '700', '707', '770', '999']) + String(100000 + Math.floor(Math.random() * 899999)),
        email: 'demo' + i + '@example.com', address: pick(streets) + ', ' + (1 + Math.floor(Math.random() * 90)),
        referralCode: newReferralCode_(), referredBy: clients.length > 3 && Math.random() < 0.25 ? pick(clients).id : '',
        vip: Math.random() < 0.1, notes: ''
      };
      insert_(SHEETS.CLIENTS, c);
      clients.push(c);
    }
    for (let i = 0; i < 90; i++) {
      const c = pick(clients), s = pick(svc), e = pick(emps), type = pick(types);
      const offset = Math.floor(Math.random() * 120) - 100; // от -100 до +20 дней
      const date = addDays_(today_(), offset);
      const ex = Math.random() < 0.5 ? [{ id: pick(extras).id, qty: 1 + Math.floor(Math.random() * 3) }] : [];
      const q = calcQuote_({ serviceId: s.id, propertyType: type, rooms: 1 + Math.floor(Math.random() * 4), extras: ex, floor: 3, elevator: true });
      let status = offset < 0 ? STATUS.DONE : offset === 0 ? STATUS.IN_PROGRESS : pick([STATUS.NEW, STATUS.ASSIGNED]);
      if (Math.random() < 0.1) status = STATUS.CANCELLED;
      insert_(SHEETS.ORDERS, {
        id: nextId_('ORD', 1000), createdAt: addDays_(date, -3) + ' 12:00', clientId: c.id, name: c.name, phone: c.phone, email: c.email,
        serviceId: s.id, serviceName: s.name, propertyType: q.propertyTypeName, rooms: q.rooms, date: date,
        time: fromMin_(8 * 60 + 60 * Math.floor(Math.random() * 8)), duration: q.duration, address: c.address, floor: 3, elevator: true, pets: false,
        extras: JSON.stringify(q.extras), extrasText: q.extras.map(function (x) { return x.name + (x.qty > 1 ? ' ×' + x.qty : ''); }).join(', '),
        subtotal: q.subtotal, discount: 0, total: q.total, status: status,
        employeeId: status === STATUS.NEW ? '' : e.id, employeeName: status === STATUS.NEW ? '' : e.name,
        cancelReason: status === STATUS.CANCELLED ? pick(reasons) : '',
        rating: status === STATUS.DONE && Math.random() < 0.6 ? pick([4, 5, 5, 5]) : '', refunded: false, updatedAt: nowStr_()
      });
    }
  });
  return 'Добавлено 25 клиентов и 90 заказов';
}
