// Delivery app translations — Proxy-based bilingual support.
// Components use `import t from '../translations.js'` unchanged.

const en = {
  // Login
  enterPin:     'Enter your driver PIN',
  login:        'Sign in',
  invalidPin:   'Invalid PIN. Try again.',
  hello:        'Hello',

  // Header
  deliveries:   'Deliveries',
  refreshList:  'Refresh',
  logout:       'Logout',

  // Status groups
  pending:       'Pending',
  outForDelivery:'Out for delivery',
  delivered:     'Delivered',

  // Card
  callRecipient: 'Call',
  openMaps:      'Navigate',
  startDelivery: 'Start delivery',
  markDelivered: 'Mark delivered',
  deliveredAt:   'Delivered at',
  fee:           'Fee',
  unpaid:        'Unpaid',
  paid:          'Paid',

  // Detail sheet
  recipient:     'Recipient',
  phone:         'Phone',
  orderedBy:     'Ordered by',
  address:       'Address',
  time:          'Time',
  orderContents: 'Order contents',
  greetingCard:  'Greeting card',
  driverNotes:   'Driver notes',
  notesPlaceholder: 'Add a note...',
  saveNote:      'Save note',
  close:         'Close',

  // Map
  viewOnMap:     'View on map',
  openAllStops:  'Open all stops in Google Maps',
  noDeliveries:  'No deliveries for today',
  yourLocation:  'Your location',
  routeStart:    'Route starts here',
  locating:      'Getting your location...',

  // Payment status
  paidBadge:     'Paid',
  unpaidBadge:   'Unpaid',
  partialBadge:  'Partial',

  // Order info
  specialInstructions: 'Special instructions',

  // Driver filter
  allDrivers:    'All',

  // Confirmation
  confirmDelivery: 'Confirm delivery?',

  // Notifications
  newOrderAlert:   'New order received',
  orderReadyAlert: 'Order ready for delivery',

  // General
  loading:       'Loading...',
  error:         'Something went wrong',
  today:         'Today',
};

const ru = {
  // Login
  enterPin:     'Введите PIN водителя',
  login:        'Войти',
  invalidPin:   'Неверный PIN. Попробуйте ещё раз.',
  hello:        'Привет',

  // Header
  deliveries:   'Доставки',
  refreshList:  'Обновить',
  logout:       'Выйти',

  // Status groups
  pending:       'Ожидают',
  outForDelivery:'В пути',
  delivered:     'Доставлено',

  // Card
  callRecipient: 'Позвонить',
  openMaps:      'Навигация',
  startDelivery: 'Начать доставку',
  markDelivered: 'Доставлено',
  deliveredAt:   'Доставлено в',
  fee:           'Стоимость',
  unpaid:        'Не оплачен',
  paid:          'Оплачен',

  // Detail sheet
  recipient:     'Получатель',
  phone:         'Телефон',
  orderedBy:     'Заказчик',
  address:       'Адрес',
  time:          'Время',
  orderContents: 'Состав заказа',
  greetingCard:  'Открытка',
  driverNotes:   'Заметки водителя',
  notesPlaceholder: 'Добавить заметку...',
  saveNote:      'Сохранить',
  close:         'Закрыть',

  // Map
  viewOnMap:     'На карте',
  openAllStops:  'Все точки в Google Maps',
  noDeliveries:  'Нет доставок на сегодня',
  yourLocation:  'Ваше местоположение',
  routeStart:    'Начало маршрута',
  locating:      'Определяем местоположение...',

  // Payment status
  paidBadge:     'Оплачен',
  unpaidBadge:   'Не оплачен',
  partialBadge:  'Частично',

  // Order info
  specialInstructions: 'Особые указания',

  // Driver filter
  allDrivers:    'Все',

  // Confirmation
  confirmDelivery: 'Подтвердить доставку?',

  // Notifications
  newOrderAlert:   'Новый заказ получен',
  orderReadyAlert: 'Заказ готов к доставке',

  // General
  loading:       'Загрузка...',
  error:         'Что-то пошло не так',
  today:         'Сегодня',
};

// ── Proxy-based dynamic translation ──
let currentLang = (typeof localStorage !== 'undefined'
  ? localStorage.getItem('blossom-lang')
  : null) || 'ru';

const langs = { en, ru };

const t = new Proxy({}, {
  get(_, key) {
    return langs[currentLang]?.[key] ?? langs.en[key] ?? key;
  },
});

export function setLanguage(lang) {
  currentLang = lang;
}

export default t;
