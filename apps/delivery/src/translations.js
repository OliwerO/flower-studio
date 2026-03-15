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
  collectPayment: 'Collect payment before handing over!',

  // Order info
  specialInstructions: 'Special instructions',

  // Driver filter
  allDrivers:    'All',

  // Delivery actions
  problem:              'Problem',
  deliveryProblem:      'What happened?',
  result_success:       'Delivered successfully',
  result_not_home:      'Not home',
  result_wrong_address: 'Wrong address',
  result_refused:       'Refused',
  result_incomplete:    'Incomplete delivery',
  cancel:               'Cancel',

  // Notifications
  newOrderAlert:   'New order received',
  orderReadyAlert: 'Order ready for delivery',

  // Confirmations
  confirmDelivered: 'Mark this delivery as completed?',

  // Stock pickup
  stockPickups:         'Stock pickups',
  stockPickupBanner:    'stock pickups assigned',
  goToPickup:           'Go to pickup',
  foundAll:             'Found all',
  partial:              'Partial',
  notFound:             'Not found',
  foundAtSupplier:      'Found at',
  howManyFound:         'How many did you find?',
  foundMoreElsewhere:   'Found more at another supplier?',
  altSupplier:          'Which supplier?',
  altAmount:            'How many?',
  foundAlternative:     'Found a substitute flower instead?',
  altFlowerName:        'Substitute flower name',
  totalPaidAt:          'Total paid at',
  doneShopping:         'Done shopping',
  need:                 'need',
  doneShoppingConfirm:  'Mark shopping as complete?',
  yes:                  'Yes',
  no:                   'No',
  note:                 'Note',
  stockPickupAssigned:  'Stock pickup assigned',

  // General
  loading:       'Loading...',
  error:         'Something went wrong',
  today:         'Today',
  lotSize:       'Lot Size',
  packs:         'packs',
  lotsFound:     'Lots found',
  totalStems:    'Total stems',
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
  collectPayment: 'Соберите оплату перед выдачей!',

  // Order info
  specialInstructions: 'Особые указания',

  // Driver filter
  allDrivers:    'Все',

  // Delivery actions
  problem:              'Проблема',
  deliveryProblem:      'Что произошло?',
  result_success:       'Доставлено успешно',
  result_not_home:      'Нет дома',
  result_wrong_address: 'Неверный адрес',
  result_refused:       'Отказ',
  result_incomplete:    'Неполная доставка',
  cancel:               'Отмена',

  // Notifications
  newOrderAlert:   'Новый заказ получен',
  orderReadyAlert: 'Заказ готов к доставке',

  // Confirmations
  confirmDelivered: 'Отметить доставку как выполненную?',

  // Stock pickup
  stockPickups:         'Закупки',
  stockPickupBanner:    'закупок назначено',
  goToPickup:           'К закупкам',
  foundAll:             'Всё найдено',
  partial:              'Частично',
  notFound:             'Не найдено',
  foundAtSupplier:      'Найдено у',
  howManyFound:         'Сколько нашли?',
  foundMoreElsewhere:   'Нашли ещё у другого поставщика?',
  altSupplier:          'Какой поставщик?',
  altAmount:            'Сколько?',
  foundAlternative:     'Нашли цветок-замену?',
  altFlowerName:        'Название замены',
  totalPaidAt:          'Оплачено у',
  doneShopping:         'Закупка завершена',
  need:                 'нужно',
  doneShoppingConfirm:  'Отметить закупку как завершённую?',
  yes:                  'Да',
  no:                   'Нет',
  note:                 'Заметка',
  stockPickupAssigned:  'Назначена закупка',

  // General
  loading:       'Загрузка...',
  error:         'Что-то пошло не так',
  today:         'Сегодня',
  lotSize:       'Фасовка',
  packs:         'уп.',
  lotsFound:     'Упаковок найдено',
  totalStems:    'Всего штук',
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
