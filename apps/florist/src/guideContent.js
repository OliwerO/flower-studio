// Florist app FAQ guide content — bilingual, same Proxy pattern as translations.js.

const en = {
  guideTitle: 'Help',
  sections: [
    {
      title: 'Orders',
      items: [
        {
          q: 'How do I create a new order?',
          a: 'Tap the "+" button at the bottom right. Choose "New order" for a blank form, or "Paste text" to auto-fill from a customer message. The 4-step wizard walks you through: Customer, Bouquet, Details, Review.',
        },
        {
          q: 'How do I update order status?',
          a: 'Tap any order card to expand it. You\'ll see status pills (e.g. New, Ready, Cancelled). Tap the desired status to update. Florists cannot set "Out for Delivery" — that\'s the driver\'s job.',
        },
        {
          q: 'How do I update payment?',
          a: 'Expand an order card and look for the Payment section. Toggle between Unpaid and Paid. When set to Paid, you can also choose the payment method (Cash, Card, Transfer).',
        },
        {
          q: 'What is the "Compose" badge?',
          a: 'Orange "Compose" badges appear on Wix website orders that arrived without a specific bouquet composition. Open the order and build the bouquet from actual stock — Wix product names don\'t always match real flowers.',
        },
      ],
    },
    {
      title: 'Customers',
      items: [
        {
          q: 'How do I find or create a customer?',
          a: 'In Step 1 of a new order, type at least 2 characters to search by name, phone, Instagram, or email. Tap a result to select. If no match, a "Create new" button appears — fill in the name (required) and save.',
        },
      ],
    },
    {
      title: 'Bouquet Builder',
      items: [
        {
          q: 'How do I build a bouquet?',
          a: 'In Step 2, search for flowers by name. Tap a flower to add 1 stem. Use the +/- buttons or type a number to adjust quantity. The running total updates automatically. Use "Price override" if you need a custom final price.',
        },
        {
          q: 'What does "Paste text" do?',
          a: 'Paste a customer message (from Instagram, WhatsApp, etc.) or a Flowwow email. AI reads the text and pre-fills the order form: customer info, flowers, delivery details. Green/yellow/red borders on flowers show match confidence.',
        },
      ],
    },
    {
      title: 'Stock',
      items: [
        {
          q: 'How do I manage stock?',
          a: 'Go to the Stock panel (top right button). To receive a shipment: tap "Receive stock", select the flower, enter quantity and prices. To write off dead stems: tap the bin icon on any item and confirm the quantity.',
        },
      ],
    },
  ],
};

const ru = {
  guideTitle: 'Помощь',
  sections: [
    {
      title: 'Заказы',
      items: [
        {
          q: 'Как создать новый заказ?',
          a: 'Нажмите "+" внизу справа. Выберите "Новый заказ" для пустой формы или "Вставить текст" для автозаполнения из сообщения клиента. Мастер из 4 шагов: Клиент, Букет, Детали, Обзор.',
        },
        {
          q: 'Как изменить статус заказа?',
          a: 'Нажмите на карточку заказа, чтобы раскрыть её. Появятся кнопки статуса (Новый, Готов, Отменён). Нажмите нужный статус. Флористы не могут поставить "В доставке" — это делает водитель.',
        },
        {
          q: 'Как обновить оплату?',
          a: 'Раскройте карточку заказа и найдите раздел «Оплата». Переключайте между «Не оплачен» и «Оплачен». При выборе «Оплачен» можно указать способ оплаты (наличные, карта, перевод).',
        },
        {
          q: 'Что означает значок «Собрать»?',
          a: 'Оранжевый значок «Собрать» появляется на заказах с сайта Wix, где нет конкретного состава букета. Откройте заказ и соберите букет из реального склада — названия товаров Wix не всегда совпадают с цветами.',
        },
      ],
    },
    {
      title: 'Клиенты',
      items: [
        {
          q: 'Как найти или создать клиента?',
          a: 'На шаге 1 нового заказа введите минимум 2 символа для поиска по имени, телефону, Instagram или email. Нажмите на результат. Если совпадений нет — появится кнопка «Создать нового», заполните имя и сохраните.',
        },
      ],
    },
    {
      title: 'Букет',
      items: [
        {
          q: 'Как собрать букет?',
          a: 'На шаге 2 ищите цветы по названию. Нажмите на цветок, чтобы добавить 1 стебель. Используйте +/- или введите число для изменения количества. Итого обновляется автоматически. «Своя цена» — для ручной установки финальной стоимости.',
        },
        {
          q: 'Что делает «Вставить текст»?',
          a: 'Вставьте сообщение клиента (из Instagram, WhatsApp и т.д.) или письмо Flowwow. AI прочитает текст и заполнит форму заказа: данные клиента, цветы, доставку. Зелёная/жёлтая/красная полоска у цветов показывает точность совпадения.',
        },
      ],
    },
    {
      title: 'Склад',
      items: [
        {
          q: 'Как управлять складом?',
          a: 'Перейдите на панель «Склад» (кнопка вверху справа). Для приёмки: нажмите «Приёмка», выберите цветок, введите количество и цены. Для списания: нажмите значок корзины у позиции и подтвердите количество.',
        },
      ],
    },
  ],
};

// Proxy-based dynamic access — same pattern as translations.js
let currentLang = (typeof localStorage !== 'undefined'
  ? localStorage.getItem('blossom-lang')
  : null) || 'ru';

const langs = { en, ru };

const guide = new Proxy({}, {
  get(_, key) {
    return langs[currentLang]?.[key] ?? langs.en[key] ?? key;
  },
});

export function setGuideLanguage(lang) {
  currentLang = lang;
}

export default guide;
