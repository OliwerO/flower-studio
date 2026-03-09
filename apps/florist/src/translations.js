// All user-facing strings in one place — Proxy-based bilingual support.
// Components still do `import t from '../translations.js'` and use `t.keyName`.
// The Proxy reads from the current language at access time.
// Re-renders are triggered by LanguageContext, not by this module.

const en = {
  // Auth
  appName:          'Blossom',
  enterPin:         'Enter PIN',
  pinPlaceholder:   '••••',
  login:            'Login',
  invalidPin:       'Invalid PIN. Try again.',
  logout:           'Log out',

  // Nav
  navOrders:        'Orders',
  navStock:         'Stock',
  navNew:           'New Order',

  // Order list
  ordersTitle:      'Orders',
  today:            'Today',
  filterStatus:     'Status',
  allStatuses:      'All',
  newOrder:         'New Order',
  noOrders:         'No orders found.',
  loading:          'Loading...',

  // Order statuses
  statusNew:        'New',
  statusInProgress: 'In Progress',
  statusReady:      'Ready',
  statusDelivered:  'Delivered',
  statusCancelled:  'Cancelled',

  // Order card
  pickup:           'Pickup',
  delivery:         'Delivery',
  unpaid:           'Unpaid',
  paid:             'Paid',

  // New order wizard
  newOrderTitle:    'New Order',
  step1:            'Customer',
  step2:            'Bouquet',
  step3:            'Details',
  step4:            'Review',
  back:             'Back',
  next:             'Next',
  submit:           'Submit Order',
  submitting:       'Submitting...',
  cancel:           'Cancel',

  // Step 1 — Customer
  searchCustomer:   'Search customer',
  searchPlaceholder:'Name, phone, Instagram...',
  createNew:        'Create new customer',
  selectCustomer:   'Select customer',
  customerName:     'Name',
  customerPhone:    'Phone',
  customerNickname: 'Nickname / Instagram',
  customerEmail:    'Email',
  saveCustomer:     'Save customer',
  customerRequired: 'Please select or create a customer.',

  // Step 2 — Bouquet
  customerRequest:  'Customer request (description)',
  requestPlaceholder: 'E.g. pink roses, something soft and romantic...',
  searchFlowers:    'Search flowers',
  flowerSearch:     'Search by name...',
  addToBouquet:     'Add',
  bouquetContents:  'Bouquet contents',
  quantity:         'Qty',
  remove:           'Remove',
  costTotal:        'Cost total',
  sellTotal:        'Sell total',
  priceOverride:    'Price override (optional)',
  noFlowersAdded:   'No flowers added yet.',
  refreshStock:     'Refresh stock',
  noStockFound:     'No flowers found.',
  outOfStock:       'Out of stock',
  bouquetRequired:  'Add at least one flower.',
  lowStock:         'Low stock',

  // Step 3 — Details
  source:           'Order source',
  sourceWalk:       'In-store',
  sourceInstagram:  'Instagram',
  sourceWhatsApp:   'WhatsApp',
  sourceTelegram:   'Telegram',
  sourceWebsite:    'Wix',
  sourceFlowwow:    'Flowwow',
  sourceOther:      'Other',
  deliveryType:     'Fulfillment',
  deliveryPickup:   'Pickup',
  deliveryDelivery: 'Delivery',
  deliveryDate:     'Delivery date',
  deliveryTime:     'Delivery time',
  recipientName:    'Recipient name',
  recipientPhone:   'Recipient phone',
  deliveryAddress:  'Delivery address',
  cardText:         'Card message',
  orderNotes:       'Notes',
  paymentStatus:    'Payment',
  paymentUnpaid:    'Unpaid',
  paymentPaid:      'Paid',
  paymentMethod:    'Payment method',
  methodCash:       'Cash',
  methodCard:       'Card',
  methodTransfer:   'Transfer',
  requiredBy:       'Required by (date/time)',
  deliveryFee:      'Delivery fee',

  // Step 4 — Review
  reviewTitle:      'Review order',
  edit:             'Edit',
  customer:         'Customer',
  bouquet:          'Bouquet',
  details:          'Details',
  orderTotal:       'Order total',
  orderSubmitted:   'Order submitted!',
  submitError:      'Failed to submit order. Please try again.',

  // Stock panel
  stockTitle:       'Stock',
  adjust:           'Adjust',
  receiveStock:     'Receive stock',
  supplier:         'Supplier',
  quantityReceived: 'Quantity received',
  pricePerUnit:     'Price per unit',
  notes:            'Notes',
  save:             'Save',
  saving:           'Saving...',
  adjustError:      'Failed to adjust stock.',
  receiveError:     'Failed to record stock receipt.',
  newStockItem:     '+ New item',
  newItemName:      'Flower name',
  newItemCategory:  'Category',

  // Stock write-off
  writeOff:         'Write off',
  deadStems:        'dead',
  confirm:          'Confirm',
  writeOffError:    'Failed to write off stock.',
  writeOffReason:   'Reason (optional)',
  editStock:        'Edit stock',
  doneEditing:      'Done',

  // Validation
  stockLoadError:        'Failed to load stock data.',
  deliveryAddressRequired: 'Delivery address is required.',

  // Toast
  success:          'Done!',
  error:            'Error',
  dismiss:          'Dismiss',

  // Text import / intake
  intake: {
    title:              'Paste text',
    modeGeneral:        'Any message',
    hintGeneral:        'Paste customer messages from any channel — AI will extract order data.',
    hintFlowwow:        'Paste Flowwow email text — we\'ll auto-detect order, address, recipient.',
    placeholderGeneral: 'Paste customer message...\n\nMultiple messages at once are fine.',
    placeholderFlowwow: 'Paste Flowwow email text...',
    parseButton:        'Parse',
    parsing:            'Parsing...',
    parseError:         'Could not parse text. Try again.',
    warningsTitle:      'Warnings',
    fabLabel:           'Paste text',
    fabManual:          'New order',
    needsComposition:   'Compose',
    confidenceHigh:     'Match found',
    confidenceLow:      'Check match',
    confidenceNone:     'Not in stock',
  },
};

const ru = {
  // Auth
  appName:          'Blossom',
  enterPin:         'Введите PIN',
  pinPlaceholder:   '••••',
  login:            'Войти',
  invalidPin:       'Неверный PIN. Попробуйте ещё раз.',
  logout:           'Выйти',

  // Nav
  navOrders:        'Заказы',
  navStock:         'Склад',
  navNew:           'Новый заказ',

  // Order list
  ordersTitle:      'Заказы',
  today:            'Сегодня',
  filterStatus:     'Статус',
  allStatuses:      'Все',
  newOrder:         'Новый заказ',
  noOrders:         'Заказы не найдены.',
  loading:          'Загрузка...',

  // Order statuses
  statusNew:        'Новый',
  statusInProgress: 'В работе',
  statusReady:      'Готов',
  statusDelivered:  'Доставлен',
  statusCancelled:  'Отменён',

  // Order card
  pickup:           'Самовывоз',
  delivery:         'Доставка',
  unpaid:           'Не оплачен',
  paid:             'Оплачен',

  // New order wizard
  newOrderTitle:    'Новый заказ',
  step1:            'Клиент',
  step2:            'Букет',
  step3:            'Детали',
  step4:            'Обзор',
  back:             'Назад',
  next:             'Далее',
  submit:           'Оформить заказ',
  submitting:       'Отправка...',
  cancel:           'Отмена',

  // Step 1 — Customer
  searchCustomer:   'Поиск клиента',
  searchPlaceholder:'Имя, телефон, Instagram...',
  createNew:        'Создать нового клиента',
  selectCustomer:   'Выбрать клиента',
  customerName:     'Имя',
  customerPhone:    'Телефон',
  customerNickname: 'Ник / Instagram',
  customerEmail:    'Email',
  saveCustomer:     'Сохранить клиента',
  customerRequired: 'Выберите или создайте клиента.',

  // Step 2 — Bouquet
  customerRequest:  'Запрос клиента (описание)',
  requestPlaceholder: 'Напр. розовые розы, что-то нежное и романтичное...',
  searchFlowers:    'Поиск цветов',
  flowerSearch:     'Поиск по названию...',
  addToBouquet:     'Добавить',
  bouquetContents:  'Состав букета',
  quantity:         'Кол-во',
  remove:           'Удалить',
  costTotal:        'Себестоимость',
  sellTotal:        'Итого продажа',
  priceOverride:    'Своя цена (опционально)',
  noFlowersAdded:   'Цветы ещё не добавлены.',
  refreshStock:     'Обновить склад',
  noStockFound:     'Цветы не найдены.',
  outOfStock:       'Нет в наличии',
  bouquetRequired:  'Добавьте хотя бы один цветок.',
  lowStock:         'Мало на складе',

  // Step 3 — Details
  source:           'Источник заказа',
  sourceWalk:       'Офлайн',
  sourceInstagram:  'Instagram',
  sourceWhatsApp:   'WhatsApp',
  sourceTelegram:   'Telegram',
  sourceWebsite:    'Wix',
  sourceFlowwow:    'Flowwow',
  sourceOther:      'Другое',
  deliveryType:     'Способ получения',
  deliveryPickup:   'Самовывоз',
  deliveryDelivery: 'Доставка',
  deliveryDate:     'Дата доставки',
  deliveryTime:     'Время доставки',
  recipientName:    'Имя получателя',
  recipientPhone:   'Телефон получателя',
  deliveryAddress:  'Адрес доставки',
  cardText:         'Текст открытки',
  orderNotes:       'Заметки',
  paymentStatus:    'Оплата',
  paymentUnpaid:    'Не оплачен',
  paymentPaid:      'Оплачен',
  paymentMethod:    'Способ оплаты',
  methodCash:       'Наличные',
  methodCard:       'Карта',
  methodTransfer:   'Перевод',
  requiredBy:       'Нужен к (дата/время)',
  deliveryFee:      'Стоимость доставки',

  // Step 4 — Review
  reviewTitle:      'Проверка заказа',
  edit:             'Изменить',
  customer:         'Клиент',
  bouquet:          'Букет',
  details:          'Детали',
  orderTotal:       'Итого',
  orderSubmitted:   'Заказ оформлен!',
  submitError:      'Не удалось оформить заказ. Попробуйте ещё раз.',

  // Stock panel
  stockTitle:       'Склад',
  adjust:           'Корректировка',
  receiveStock:     'Приёмка',
  supplier:         'Поставщик',
  quantityReceived: 'Количество',
  pricePerUnit:     'Цена за единицу',
  notes:            'Заметки',
  save:             'Сохранить',
  saving:           'Сохранение...',
  adjustError:      'Не удалось скорректировать склад.',
  receiveError:     'Не удалось записать приёмку.',
  newStockItem:     '+ Новая позиция',
  newItemName:      'Название цветка',
  newItemCategory:  'Категория',

  // Stock write-off
  writeOff:         'Списание',
  deadStems:        'списано',
  confirm:          'Подтвердить',
  writeOffError:    'Не удалось списать.',
  writeOffReason:   'Причина (опционально)',
  editStock:        'Редактировать склад',
  doneEditing:      'Готово',

  // Validation
  stockLoadError:        'Не удалось загрузить данные склада.',
  deliveryAddressRequired: 'Укажите адрес доставки.',

  // Toast
  success:          'Готово!',
  error:            'Ошибка',
  dismiss:          'Закрыть',

  // Text import / intake
  intake: {
    title:              'Вставить текст',
    modeGeneral:        'Любое сообщение',
    hintGeneral:        'Вставьте сообщения клиента из любого канала — AI извлечёт данные заказа.',
    hintFlowwow:        'Вставьте текст письма от Flowwow — автоматически распознаем заказ, адрес, получателя.',
    placeholderGeneral: 'Вставьте сообщение клиента...\n\nМожно несколько сообщений сразу.',
    placeholderFlowwow: 'Вставьте текст письма Flowwow...',
    parseButton:        'Распознать',
    parsing:            'Распознаём...',
    parseError:         'Не удалось распознать текст. Попробуйте ещё раз.',
    warningsTitle:      'Предупреждения',
    fabLabel:           'Вставить текст',
    fabManual:          'Новый заказ',
    needsComposition:   'Нужно собрать',
    confidenceHigh:     'Совпадение найдено',
    confidenceLow:      'Проверьте соответствие',
    confidenceNone:     'Не найдено на складе',
  },
};

// ── Proxy-based dynamic translation ──
// The Proxy reads from whichever language is currently active.
// When LanguageContext triggers a re-render, components re-read `t.key`
// and get the updated language automatically. No import changes needed.

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
