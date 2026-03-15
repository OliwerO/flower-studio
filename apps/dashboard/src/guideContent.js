// Dashboard app FAQ guide content — bilingual, same Proxy pattern as translations.js.

const en = {
  guideTitle: 'Help',
  sections: [
    {
      title: 'Today & Navigation',
      items: [
        {
          q: 'What does the Today tab show?',
          a: 'A real-time operational snapshot: orders by status, pending deliveries, low stock alerts, and revenue for today. Clicking any widget navigates to the relevant tab with filters pre-applied.',
        },
        {
          q: 'How does clicking widgets work?',
          a: 'Widgets act as shortcuts. For example, clicking "Pending deliveries" opens the Orders tab filtered to delivery orders that haven\'t shipped yet. The target tab resets to show exactly what you clicked.',
        },
      ],
    },
    {
      title: 'Orders',
      items: [
        {
          q: 'How do I manage orders?',
          a: 'Go to the Orders tab. Use the search bar and status/date filters to find orders. Click any order to expand it — you can edit status, payment, driver assignment, bouquet composition, and prices.',
        },
        {
          q: 'How do I create an order from the dashboard?',
          a: 'Use the "New Order" tab. The same 4-step wizard as the florist app: Customer → Bouquet → Details → Review. You can also paste a customer message for AI-assisted auto-fill.',
        },
        {
          q: 'How do I assign a driver?',
          a: 'In the Orders tab, expand a delivery order. You\'ll see driver pills (Piotr, Nikita, Ilona). Tap the desired driver to assign. You can reassign at any time before delivery.',
        },
      ],
    },
    {
      title: 'Stock & Customers',
      items: [
        {
          q: 'How do I manage stock?',
          a: 'The Stock tab shows all inventory grouped by category. Edit quantities and prices inline. Use "Receive stock" for new shipments and the write-off button for dead stems. Low stock items are highlighted.',
        },
        {
          q: 'How do I manage customers?',
          a: 'The Customers tab has a searchable list. Click a customer to see their full profile: contact info, order history, total spend, segment. Edit details inline. "DO NOT CONTACT" customers show a red warning.',
        },
      ],
    },
    {
      title: 'Financial KPIs',
      items: [
        {
          q: 'What do the Financial KPIs mean?',
          a: 'The Financial tab shows business metrics for any date range: total revenue, average order value, gross margin, flower costs, waste percentage, delivery profitability, and customer acquisition. All calculated from real order data.',
        },
      ],
    },
  ],
};

const ru = {
  guideTitle: 'Помощь',
  sections: [
    {
      title: 'Сегодня и навигация',
      items: [
        {
          q: 'Что показывает вкладка «Сегодня»?',
          a: 'Оперативную сводку в реальном времени: заказы по статусам, ожидающие доставки, предупреждения о низком запасе и выручку за день. Нажатие на любой виджет переводит на нужную вкладку с фильтрами.',
        },
        {
          q: 'Как работают виджеты-ссылки?',
          a: 'Виджеты — это ярлыки. Например, нажатие на «Ожидающие доставки» откроет вкладку «Заказы» с фильтром по доставкам, которые ещё не отправлены. Целевая вкладка перезагружается с нужными фильтрами.',
        },
      ],
    },
    {
      title: 'Заказы',
      items: [
        {
          q: 'Как управлять заказами?',
          a: 'Перейдите на вкладку «Заказы». Используйте поиск и фильтры по статусу/дате. Нажмите на заказ, чтобы раскрыть — можно редактировать статус, оплату, водителя, состав букета и цены.',
        },
        {
          q: 'Как создать заказ из панели управления?',
          a: 'Используйте вкладку «Новый заказ». Тот же мастер из 4 шагов: Клиент → Букет → Детали → Обзор. Можно вставить сообщение клиента для автоматического заполнения через AI.',
        },
        {
          q: 'Как назначить водителя?',
          a: 'На вкладке «Заказы» раскройте заказ с доставкой. Появятся кнопки водителей (Тимур, Никита, Дмитрий). Нажмите нужного водителя. Можно переназначить в любой момент до доставки.',
        },
      ],
    },
    {
      title: 'Склад и клиенты',
      items: [
        {
          q: 'Как управлять складом?',
          a: 'Вкладка «Склад» показывает весь инвентарь по категориям. Редактируйте количество и цены прямо в таблице. «Приёмка» — для новых поставок, кнопка списания — для испорченных цветов. Низкий запас выделен.',
        },
        {
          q: 'Как управлять клиентами?',
          a: 'Вкладка «Клиенты» — поиск по списку. Нажмите на клиента для просмотра профиля: контакты, история заказов, общая сумма, сегмент. Редактируйте данные на месте. Клиенты «НЕ КОНТАКТИРОВАТЬ» отмечены красным.',
        },
      ],
    },
    {
      title: 'Финансовые показатели',
      items: [
        {
          q: 'Что означают финансовые KPI?',
          a: 'Вкладка «Финансы» показывает бизнес-метрики за любой период: общую выручку, средний чек, маржу, затраты на цветы, процент потерь, прибыльность доставки и привлечение клиентов. Всё рассчитывается из реальных данных заказов.',
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
