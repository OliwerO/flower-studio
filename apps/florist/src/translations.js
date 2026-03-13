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

  // Order statuses (display labels — API values stay English)
  statusNew:            'New',
  statusInProgress:     'In Progress',
  statusReady:          'Ready',
  statusOutForDelivery: 'Out for Delivery',
  statusDelivered:      'Delivered',
  statusPickedUp:       'Picked Up',
  statusCancelled:      'Cancelled',

  // Order card
  pickup:           'Pickup',
  delivery:         'Delivery',
  unpaid:           'Unpaid',
  paid:             'Paid',
  collectPayment:   'Collect payment before handing over!',

  // Section / field labels
  labelBouquet:         'Bouquet',
  labelDelivery:        'Delivery',
  labelStatus:          'Status',
  labelPayment:         'Payment',
  labelNotes:           'Notes',
  labelDate:            'Date',
  labelTime:            'Time',
  labelOrderDate:       'Ordered',
  labelAddress:         'Address',
  labelRecipient:       'Recipient',
  labelPhone:           'Phone',
  labelCardMsg:         'Card msg',
  labelFee:             'Fee',
  labelName:            'Name',
  labelNickname:        'Nickname',
  labelCustomerRequest: 'Customer request',
  labelTotal:           'Total',
  labelPickupTime:      'Pickup time',
  labelSource:          'Source',
  labelInfo:            'Info',
  labelDeliveryTiming:  'Delivery timing',
  collapse:             'Collapse',
  errorLoadDetails:     'Could not load details.',
  updated:              'Updated!',
  updateError:          'Failed to update.',
  loadError:            'Failed to load details.',

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
  optional:         'optional',
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
  writeOffReason:   'Select reason',
  reasonWilted:     'Wilted',
  reasonDamaged:    'Broken at delivery',
  editStock:        'Edit stock',
  doneEditing:      'Done',

  // Stock deferred (future orders)
  useStock:              'Stock',
  orderNew:              'New',

  // Negative stock
  notInStock:            'not in stock',
  negativeStockWarning:  'Some items went below zero stock. Create a purchase order?',
  outOfStock:            'Out of stock',

  // Stock evaluation
  stockEvaluation:       'Stock Evaluation',
  stockEvalBanner:       'Stock delivery to evaluate',
  driverFound:           'Driver found',
  accept:                'Accept',
  writeOffQty:           'Write off',
  completeEvaluation:    'Complete Evaluation',
  notFoundByDriver:      'Not found by driver',
  addManually:           'Add manually',
  evaluationComplete:    'Evaluation complete!',
  evaluationError:       'Failed to complete evaluation.',

  // Validation
  stockLoadError:        'Failed to load stock data.',
  deliveryAddressRequired: 'Delivery address is required.',

  // Toast
  success:          'Done!',
  error:            'Error',
  dismiss:          'Dismiss',

  // Owner features
  owner: {
    today:              'Today',
    orders:             'orders',
    paidLabel:          'Paid',
    unpaidLabel:        'Unpaid',
    finances:           'Finances',
    cost:               'Cost',
    margin:             'Margin',
    stockAlerts:        'Stock Alerts',
    outOfStock:         'out of stock',
    left:               'left',
    threshold:          'threshold',
    dismissAlerts:      'Dismiss',
    daySummary:         'Day Summary',
    revenue:            'Revenue',
    statusBreakdown:    'Status Breakdown',
    pendingDeliveries:  'Pending Deliveries',
    unpaidOrders:       'Unpaid Orders',
    noDeliveries:       'No pending deliveries',
    noUnpaid:           'All orders paid',
    noAlerts:           'Stock levels OK',
  },

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
  lotSize:            'Lot Size',
  packs:              'packs',

  // Shopping support (owner)
  shopping: {
    title:          'Shopping Support',
    banner:         'Active purchase orders',
    empty:          'No active purchase orders',
    driver:         'Driver',
    need:           'Need',
    pending:        'Pending',
    foundAll:       'Found',
    partial:        'Partial',
    notFound:       'Not found',
    qtyFound:       'Qty found',
    costPrice:      'Cost price',
    altFlower:      'Alt flower',
    altFlowerHint:  'Alternative flower name...',
    altSupplier:    'Alt supplier',
    altQty:         'Alt qty',
    notes:          'Notes',
    notesHint:      'Note for driver or florist...',
    paidTo:         'Paid to',
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

  // Order statuses (display labels — API values stay English)
  statusNew:            'Новый',
  statusInProgress:     'В работе',
  statusReady:          'Готов',
  statusOutForDelivery: 'В доставке',
  statusDelivered:      'Доставлен',
  statusPickedUp:       'Забран',
  statusCancelled:      'Отменён',

  // Order card
  pickup:           'Самовывоз',
  delivery:         'Доставка',
  unpaid:           'Не оплачен',
  paid:             'Оплачен',
  collectPayment:   'Соберите оплату перед выдачей!',

  // Section / field labels
  labelBouquet:         'Букет',
  labelDelivery:        'Доставка',
  labelStatus:          'Статус',
  labelPayment:         'Оплата',
  labelNotes:           'Заметки',
  labelDate:            'Дата',
  labelTime:            'Время',
  labelOrderDate:       'Заказано',
  labelAddress:         'Адрес',
  labelRecipient:       'Получатель',
  labelPhone:           'Телефон',
  labelCardMsg:         'Текст открытки',
  labelFee:             'Стоимость',
  labelName:            'Имя',
  labelNickname:        'Ник',
  labelCustomerRequest: 'Запрос клиента',
  labelTotal:           'Итого',
  labelPickupTime:      'Время самовывоза',
  labelSource:          'Источник',
  labelInfo:            'Инфо',
  labelDeliveryTiming:  'Время доставки',
  collapse:             'Свернуть',
  errorLoadDetails:     'Не удалось загрузить детали.',
  updated:              'Обновлено!',
  updateError:          'Не удалось обновить.',
  loadError:            'Не удалось загрузить детали.',

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
  optional:         'необязательно',
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
  writeOffReason:   'Выберите причину',
  reasonWilted:     'Завяли',
  reasonDamaged:    'Сломаны при доставке',
  editStock:        'Редактировать склад',
  doneEditing:      'Готово',

  // Stock deferred (future orders)
  useStock:              'Со склада',
  orderNew:              'Заказать',

  // Negative stock
  notInStock:            'нет на складе',
  negativeStockWarning:  'Некоторые позиции ушли в минус. Создать заказ поставщику?',
  outOfStock:            'Нет в наличии',

  // Stock evaluation
  stockEvaluation:       'Оценка цветов',
  stockEvalBanner:       'Цветы для оценки',
  driverFound:           'Водитель нашёл',
  accept:                'Принять',
  writeOffQty:           'Списать',
  completeEvaluation:    'Завершить оценку',
  notFoundByDriver:      'Не найдено водителем',
  addManually:           'Добавить вручную',
  evaluationComplete:    'Оценка завершена!',
  evaluationError:       'Не удалось завершить оценку.',

  // Validation
  stockLoadError:        'Не удалось загрузить данные склада.',
  deliveryAddressRequired: 'Укажите адрес доставки.',

  // Toast
  success:          'Готово!',
  error:            'Ошибка',
  dismiss:          'Закрыть',

  // Owner features
  owner: {
    today:              'Сегодня',
    orders:             'заказов',
    paidLabel:          'Оплачено',
    unpaidLabel:        'Не оплачено',
    finances:           'Финансы',
    cost:               'Себестоимость',
    margin:             'Маржа',
    stockAlerts:        'Склад — внимание',
    outOfStock:         'нет в наличии',
    left:               'осталось',
    threshold:          'порог',
    dismissAlerts:      'Скрыть',
    daySummary:         'Сводка дня',
    revenue:            'Выручка',
    statusBreakdown:    'По статусам',
    pendingDeliveries:  'Ожидающие доставки',
    unpaidOrders:       'Неоплаченные заказы',
    noDeliveries:       'Нет ожидающих доставок',
    noUnpaid:           'Все заказы оплачены',
    noAlerts:           'Склад в порядке',
  },

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
  lotSize:            'Фасовка',
  packs:              'уп.',

  // Shopping support (owner)
  shopping: {
    title:          'Поддержка закупки',
    banner:         'Активные заказы поставщикам',
    empty:          'Нет активных заказов поставщикам',
    driver:         'Водитель',
    need:           'Нужно',
    pending:        'Ожидание',
    foundAll:       'Найдено',
    partial:        'Частично',
    notFound:       'Не найдено',
    qtyFound:       'Найдено шт.',
    costPrice:      'Цена закупки',
    altFlower:      'Замена',
    altFlowerHint:  'Название замены...',
    altSupplier:    'Другой поставщик',
    altQty:         'Кол-во замены',
    notes:          'Заметки',
    notesHint:      'Заметка для водителя или флориста...',
    paidTo:         'Оплачено',
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
