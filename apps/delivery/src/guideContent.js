// Delivery app FAQ guide content — bilingual, same Proxy pattern as translations.js.

const en = {
  guideTitle: 'Help',
  sections: [
    {
      title: 'Deliveries',
      items: [
        {
          q: 'How do I view today\'s deliveries?',
          a: 'After login, you see today\'s deliveries grouped by status: Pending, Out for Delivery, and Delivered. Your own deliveries float to the top automatically.',
        },
        {
          q: 'How do I start a delivery?',
          a: 'Find the order in the Pending section. Tap the blue "Start delivery" button. The order moves to "Out for Delivery" and the system records the start time.',
        },
        {
          q: 'How do I mark a delivery as complete?',
          a: 'On an active delivery, tap the green "Mark delivered" button. Confirm in the popup. The system records the delivery time automatically.',
        },
      ],
    },
    {
      title: 'Navigation & Calls',
      items: [
        {
          q: 'How do I navigate to the address?',
          a: 'Tap the address on any delivery card (or in the detail sheet). It opens Google Maps with directions. You can also use the Map view to see all stops at once.',
        },
        {
          q: 'How do I call the recipient or customer?',
          a: 'Tap the phone number on the card or in the detail sheet. It opens your phone\'s dialer. If it\'s a gift order, you\'ll also see the customer\'s phone (the person who ordered).',
        },
        {
          q: 'How do I use the map view?',
          a: 'Tap "View on map" at the bottom of the delivery list. You\'ll see all undelivered stops on a map. Tap a pin to see details and get directions.',
        },
      ],
    },
    {
      title: 'Other',
      items: [
        {
          q: 'How do I add driver notes?',
          a: 'Tap a delivery card to open the detail sheet. Scroll down to "Driver notes" and type your note (e.g., "Left at reception", "Customer not home"). Tap "Save note".',
        },
        {
          q: 'What do payment badges mean?',
          a: 'Green "Paid" = already paid, nothing to collect. Red "Unpaid" = you need to collect cash from the recipient. Yellow "Partial" = partial payment received.',
        },
      ],
    },
  ],
};

const ru = {
  guideTitle: 'Помощь',
  sections: [
    {
      title: 'Доставки',
      items: [
        {
          q: 'Как посмотреть сегодняшние доставки?',
          a: 'После входа вы видите доставки на сегодня, сгруппированные по статусу: Ожидают, В пути и Доставлено. Ваши собственные доставки всегда наверху списка.',
        },
        {
          q: 'Как начать доставку?',
          a: 'Найдите заказ в разделе «Ожидают». Нажмите синюю кнопку «Начать доставку». Заказ переместится в «В пути», система зафиксирует время начала.',
        },
        {
          q: 'Как отметить доставку выполненной?',
          a: 'На активной доставке нажмите зелёную кнопку «Доставлено». Подтвердите во всплывающем окне. Система автоматически запишет время доставки.',
        },
      ],
    },
    {
      title: 'Навигация и звонки',
      items: [
        {
          q: 'Как проложить маршрут до адреса?',
          a: 'Нажмите на адрес на карточке доставки (или в детальном окне). Откроется Google Maps с маршрутом. Также можно использовать вид карты для всех точек сразу.',
        },
        {
          q: 'Как позвонить получателю или заказчику?',
          a: 'Нажмите на номер телефона на карточке или в детальном окне — откроется набор номера. Если это подарок, вы также увидите телефон заказчика.',
        },
        {
          q: 'Как использовать вид карты?',
          a: 'Нажмите «На карте» внизу списка доставок. Вы увидите все недоставленные точки на карте. Нажмите на метку для деталей и маршрута.',
        },
      ],
    },
    {
      title: 'Прочее',
      items: [
        {
          q: 'Как добавить заметку водителя?',
          a: 'Нажмите на карточку доставки, чтобы открыть детали. Прокрутите до «Заметки водителя» и введите текст (напр., «Оставил на ресепшене»). Нажмите «Сохранить».',
        },
        {
          q: 'Что означают значки оплаты?',
          a: 'Зелёный «Оплачен» = уже оплачено, ничего собирать не нужно. Красный «Не оплачен» = нужно получить наличные от получателя. Жёлтый «Частично» = частичная оплата.',
        },
      ],
    },
  ],
};

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
