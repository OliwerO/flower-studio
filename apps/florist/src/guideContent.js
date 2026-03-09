// Florist app FAQ guide content — bilingual, same Proxy pattern as translations.js.
// Comprehensive tutorial covering all workflows a florist needs daily.

const en = {
  guideTitle: 'Help & Tutorial',
  sections: [
    {
      title: 'Getting Started',
      items: [
        {
          q: 'How do I log in?',
          a: 'Enter your 4-digit PIN on the login screen and tap "Log in". Florists and the owner each have their own PIN. If you enter a driver PIN, you\'ll be redirected to the delivery app.',
        },
        {
          q: 'How do I switch language?',
          a: 'Tap the "EN" or "RU" button in the top navigation bar. The app supports English and Russian. Your choice is saved automatically.',
        },
        {
          q: 'What does each screen do?',
          a: 'Orders — the main screen with all orders, filters, and the "+" button to create new ones. Stock — inventory management (receive shipments, write off stems). Order detail — tap any order card to see full details and update status/payment.',
        },
      ],
    },
    {
      title: 'Creating Orders',
      items: [
        {
          q: 'How do I create a new order?',
          a: 'Tap the "+" button at the bottom right. Choose "New order" for a blank form, or "Paste text" to auto-fill from a customer message. The 4-step wizard: Step 1 — find or create customer, Step 2 — build bouquet, Step 3 — source, delivery & payment, Step 4 — review & submit.',
        },
        {
          q: 'Step 1: How do I find a customer?',
          a: 'Type at least 2 characters to search by name, nickname, phone, Instagram handle, or email. Results appear instantly. Tap to select. If no match is found, a "Create new" button appears — fill in the name (required) and any other info, then save.',
        },
        {
          q: 'Step 2: How do I build a bouquet?',
          a: 'First, write the customer\'s request in the text area (e.g. "pastel spring bouquet"). Then search flowers by name or category below. Tap a flower row to add 1 stem — tap again for more. Use the −/+ buttons or type a number to adjust quantity. Items in the bouquet are highlighted in purple. Tap ✕ to remove. The sell total updates live at the bottom.',
        },
        {
          q: 'Step 2: What is "Price override"?',
          a: 'If the customer agreed on a fixed price that differs from the sum of flower prices, enter it in "Price override". This becomes the final order price instead of the calculated total. Leave empty to use the automatic total.',
        },
        {
          q: 'Step 2: What do cost/margin numbers mean?',
          a: 'Tap the totals bar to toggle cost visibility. "Sell total" = what the customer pays. "Cost total" = what the flowers cost us. "Margin" = profit percentage. This helps you check if the bouquet is profitable before submitting.',
        },
        {
          q: 'Step 3: What details do I fill in?',
          a: 'Source — where the order came from (In-store, Instagram, WhatsApp, etc.). Fulfillment — Pickup or Delivery. If Delivery: fill in date, time, recipient name, phone, address, and optional greeting card text. Payment — Unpaid or Paid, and if paid, the method (Cash, Card, Transfer, etc.). Notes — any special instructions.',
        },
        {
          q: 'Step 3: What is the delivery fee?',
          a: 'The delivery fee is pre-filled with the default value (set by the owner in Settings). You can change it for this order. For Pickup orders, the fee is automatically 0.',
        },
        {
          q: 'Step 4: How do I review and submit?',
          a: 'Review all details on the summary screen. Tap "Edit" next to any section to go back and fix it. When everything looks correct, tap "Submit order" at the bottom. The order is created and you return to the order list. If you navigate away before submitting, a warning will ask if you really want to leave.',
        },
      ],
    },
    {
      title: 'AI Text Import',
      items: [
        {
          q: 'What does "Paste text" do?',
          a: 'Paste a customer message (from Instagram, WhatsApp, Telegram, etc.) or a Flowwow order email. AI reads the text and auto-fills the entire order form: customer info, flower items, delivery details, and notes. You review and correct before submitting. Works in Russian, Polish, Ukrainian, English, and Turkish.',
        },
        {
          q: 'How do I use it?',
          a: 'Tap "+" → "Paste text". Choose mode: "Any message" for general texts or "Flowwow" for Flowwow order emails. Paste the text into the field and tap "Parse". Wait a few seconds. The form is pre-filled — review each step carefully and fix anything the AI got wrong.',
        },
        {
          q: 'What do the colored borders mean on flowers?',
          a: 'After AI import, flowers in the bouquet have colored left borders. Green = high confidence match (AI is sure this is the right flower from stock). Yellow with "?" = low confidence (probable match, please verify). Red with "✗" = no match found (flower name from the message, not linked to stock). You can remove wrong matches and add correct ones manually.',
        },
        {
          q: 'Can I edit after AI fills the form?',
          a: 'Yes! The AI draft is just a starting point. Edit anything: add or remove flowers, change quantities, correct customer info, fix delivery details. The form works exactly the same as a manual order after import.',
        },
      ],
    },
    {
      title: 'Managing Orders',
      items: [
        {
          q: 'How do I find an order?',
          a: 'Use the date filter at the top (today, yesterday, last 7 days, last 30 days, or all). Use the status filter to show only specific statuses (New, Ready, etc.). Orders are sorted newest first.',
        },
        {
          q: 'How do I update order status?',
          a: 'Tap an order card to expand it. You\'ll see status pill buttons: New → Ready → Delivered/Picked Up. Tap the desired status. Note: florists cannot set "Out for Delivery" — the driver does that from the delivery app. You CAN cancel an order from any status.',
        },
        {
          q: 'How do I update payment?',
          a: 'Expand an order card and find the Payment section. Toggle between Unpaid and Paid. When set to Paid, choose the payment method (Cash, Card, Transfer, etc.). Changes save instantly.',
        },
        {
          q: 'What is the "Compose" badge?',
          a: 'Orange "Compose" badges appear on Wix website orders that arrived without a specific bouquet composition. Wix product names (e.g. "Medium bouquet") don\'t match real flowers. Open the order and build the actual bouquet from stock — this is required before preparation.',
        },
        {
          q: 'What do the notification sounds mean?',
          a: 'When a new order arrives from Wix or Flowwow, you\'ll hear a notification sound and see a popup. Tap the notification to jump directly to the new order. This works in real-time — no need to refresh.',
        },
      ],
    },
    {
      title: 'Stock Management',
      items: [
        {
          q: 'How do I open stock?',
          a: 'Tap the inventory icon in the top navigation bar (top right). This shows all active flowers with current quantities, prices, and stock levels.',
        },
        {
          q: 'How do I receive a shipment?',
          a: 'In the Stock panel, tap "+ Receive stock". Select the flower, enter quantity received, price per unit, choose the supplier, and set the date. Tap "Save" — the stock quantity updates automatically.',
        },
        {
          q: 'How do I write off dead stems?',
          a: 'Find the flower in the stock list. Tap the trash/bin icon. Enter the number of dead or unsold stems and optionally a reason. Confirm — the quantity is reduced and the loss is logged.',
        },
        {
          q: 'What do the stock indicators mean?',
          a: 'Green quantity = normal stock level. Orange "low" = quantity is at or below the reorder threshold (time to order more). Red "out" = zero stock, this flower cannot be added to bouquets. In the bouquet builder, out-of-stock flowers are greyed out.',
        },
        {
          q: 'Can I edit prices or thresholds?',
          a: 'Only the owner can edit stock details. If logged in as owner, tap "Edit stock" to unlock inline editing of cost price, sell price, and reorder threshold. Florists can only receive shipments and write off stems.',
        },
      ],
    },
    {
      title: 'Tips & Shortcuts',
      items: [
        {
          q: 'How do I refresh stock prices in the bouquet builder?',
          a: 'Tap "Refresh stock" above the flower search in Step 2. This reloads current quantities and prices from the database without leaving the order form.',
        },
        {
          q: 'Can I type a quantity directly instead of tapping +?',
          a: 'Yes! Tap the number between the − and + buttons in the bouquet cart. Type the quantity you want and tap elsewhere (or press Enter). The new quantity is applied. Type 0 to remove an item.',
        },
        {
          q: 'What happens if I close the app mid-order?',
          a: 'If you have unsaved order data (customer selected, flowers added, or request typed), the browser will warn you before closing. Your data is NOT saved to the server until you submit in Step 4. If you close anyway, you\'ll need to start over.',
        },
        {
          q: 'How do I log out?',
          a: 'Tap "Log out" in the top navigation bar. You\'ll return to the PIN screen. Your session is not stored — you need to enter the PIN again next time.',
        },
      ],
    },
  ],
};

const ru = {
  guideTitle: 'Помощь и руководство',
  sections: [
    {
      title: 'Начало работы',
      items: [
        {
          q: 'Как войти в приложение?',
          a: 'Введите свой 4-значный PIN на экране входа и нажмите «Войти». У флористов и владельца свои PIN-коды. Если ввести PIN водителя — откроется приложение доставки.',
        },
        {
          q: 'Как сменить язык?',
          a: 'Нажмите кнопку «EN» или «RU» в верхней панели навигации. Приложение поддерживает английский и русский. Выбор сохраняется автоматически.',
        },
        {
          q: 'Что делает каждый экран?',
          a: 'Заказы — главный экран со всеми заказами, фильтрами и кнопкой «+» для создания новых. Склад — управление запасами (приёмка, списание). Карточка заказа — нажмите на заказ, чтобы увидеть детали и обновить статус/оплату.',
        },
      ],
    },
    {
      title: 'Создание заказов',
      items: [
        {
          q: 'Как создать новый заказ?',
          a: 'Нажмите «+» внизу справа. Выберите «Новый заказ» для пустой формы или «Вставить текст» для автозаполнения из сообщения. Мастер из 4 шагов: Шаг 1 — найти или создать клиента, Шаг 2 — собрать букет, Шаг 3 — источник, доставка и оплата, Шаг 4 — проверить и отправить.',
        },
        {
          q: 'Шаг 1: Как найти клиента?',
          a: 'Введите минимум 2 символа для поиска по имени, нику, телефону, Instagram или email. Результаты появляются мгновенно. Нажмите, чтобы выбрать. Если совпадений нет — появится кнопка «Создать нового»: заполните имя (обязательно) и другие данные, затем сохраните.',
        },
        {
          q: 'Шаг 2: Как собрать букет?',
          a: 'Сначала опишите пожелание клиента в текстовом поле (например, «нежный весенний букет»). Затем ищите цветы по названию или категории. Нажмите на строку цветка — добавится 1 стебель, нажмите ещё раз для большего количества. Используйте −/+ или введите число. Выбранные цветы подсвечены фиолетовым. Нажмите ✕ для удаления. Итого обновляется внизу.',
        },
        {
          q: 'Шаг 2: Что такое «Своя цена»?',
          a: 'Если с клиентом договорились о фиксированной цене, отличной от суммы цветов, введите её в поле «Своя цена». Это станет финальной ценой заказа. Оставьте пустым, чтобы использовать автоматический итог.',
        },
        {
          q: 'Шаг 2: Что означают себестоимость и маржа?',
          a: 'Нажмите на строку итогов, чтобы показать/скрыть себестоимость. «Продажа» = сколько платит клиент. «Себестоимость» = наши затраты на цветы. «Маржа» = процент прибыли. Это помогает проверить прибыльность букета перед отправкой.',
        },
        {
          q: 'Шаг 3: Какие детали заполнять?',
          a: 'Источник — откуда пришёл заказ (Магазин, Instagram, WhatsApp и т.д.). Тип — Самовывоз или Доставка. Если доставка: дата, время, имя получателя, телефон, адрес и текст открытки (необязательно). Оплата — Не оплачен или Оплачен, и способ оплаты. Заметки — особые пожелания.',
        },
        {
          q: 'Шаг 3: Что такое стоимость доставки?',
          a: 'Стоимость доставки заполняется автоматически значением по умолчанию (владелец устанавливает в настройках). Вы можете изменить её для конкретного заказа. Для самовывоза стоимость автоматически 0.',
        },
        {
          q: 'Шаг 4: Как проверить и отправить?',
          a: 'Проверьте все данные на экране обзора. Нажмите «Изменить» рядом с любым разделом, чтобы вернуться и исправить. Когда всё верно, нажмите «Создать заказ» внизу. Заказ создаётся и вы возвращаетесь к списку. Если уйти до отправки — появится предупреждение.',
        },
      ],
    },
    {
      title: 'Импорт текста (AI)',
      items: [
        {
          q: 'Что делает «Вставить текст»?',
          a: 'Вставьте сообщение клиента (из Instagram, WhatsApp, Telegram и т.д.) или email заказа Flowwow. AI прочитает текст и заполнит всю форму: данные клиента, цветы, доставку и заметки. Вы проверяете и корректируете перед отправкой. Работает на русском, польском, украинском, английском и турецком.',
        },
        {
          q: 'Как использовать?',
          a: 'Нажмите «+» → «Вставить текст». Выберите режим: «Любое сообщение» для обычных текстов или «Flowwow» для писем Flowwow. Вставьте текст и нажмите «Распознать». Подождите несколько секунд. Форма заполнится — проверьте каждый шаг и исправьте, если AI ошибся.',
        },
        {
          q: 'Что означают цветные полоски у цветов?',
          a: 'После импорта у цветов в букете появляются цветные полоски слева. Зелёная = высокая уверенность (AI точно определил цветок со склада). Жёлтая с «?» = низкая уверенность (вероятное совпадение, проверьте). Красная с «✗» = совпадений нет (название из сообщения, не привязано к складу). Вы можете удалить неверные и добавить правильные вручную.',
        },
        {
          q: 'Можно ли редактировать после автозаполнения?',
          a: 'Да! Черновик AI — только отправная точка. Редактируйте всё: добавляйте и удаляйте цветы, меняйте количество, исправляйте данные клиента, детали доставки. Форма работает точно так же, как при ручном создании.',
        },
      ],
    },
    {
      title: 'Управление заказами',
      items: [
        {
          q: 'Как найти заказ?',
          a: 'Используйте фильтр даты вверху (сегодня, вчера, 7 дней, 30 дней или все). Используйте фильтр статуса для отображения конкретных статусов (Новый, Готов и т.д.). Заказы отсортированы от новых к старым.',
        },
        {
          q: 'Как обновить статус заказа?',
          a: 'Нажмите на карточку заказа. Появятся кнопки статуса: Новый → Готов → Доставлен/Забран. Нажмите нужный статус. Флористы не могут поставить «В доставке» — это делает водитель в своём приложении. Отменить заказ можно из любого статуса.',
        },
        {
          q: 'Как обновить оплату?',
          a: 'Раскройте карточку заказа. В разделе «Оплата» переключайте между «Не оплачен» и «Оплачен». При выборе «Оплачен» выберите способ (наличные, карта, перевод и т.д.). Изменения сохраняются мгновенно.',
        },
        {
          q: 'Что означает значок «Собрать»?',
          a: 'Оранжевый значок «Собрать» появляется на заказах с сайта Wix без конкретного состава букета. Названия товаров Wix (напр. «Средний букет») не совпадают с реальными цветами. Откройте заказ и соберите букет из склада — это нужно сделать до начала подготовки.',
        },
        {
          q: 'Что означают звуковые уведомления?',
          a: 'Когда приходит новый заказ с Wix или Flowwow, вы услышите звук и увидите всплывающее уведомление. Нажмите на него, чтобы перейти к новому заказу. Работает в реальном времени — обновлять страницу не нужно.',
        },
      ],
    },
    {
      title: 'Управление складом',
      items: [
        {
          q: 'Как открыть склад?',
          a: 'Нажмите значок склада в верхней панели (справа). Откроется список всех активных цветов с текущим количеством, ценами и уровнями запасов.',
        },
        {
          q: 'Как принять поставку?',
          a: 'На панели «Склад» нажмите «+ Приёмка». Выберите цветок, введите количество, цену за единицу, выберите поставщика и дату. Нажмите «Сохранить» — количество на складе обновится автоматически.',
        },
        {
          q: 'Как списать мёртвые стебли?',
          a: 'Найдите цветок в списке склада. Нажмите значок корзины. Введите количество мёртвых или непроданных стеблей и причину (необязательно). Подтвердите — количество уменьшится, потеря будет записана в журнал.',
        },
        {
          q: 'Что означают индикаторы на складе?',
          a: 'Зелёное количество = нормальный уровень. Оранжевая метка «мало» = количество на уровне или ниже порога перезаказа (пора заказать ещё). Красная метка «нет» = нулевой запас, этот цветок нельзя добавить в букет. В конструкторе букетов такие цветы отображаются серым.',
        },
        {
          q: 'Можно ли редактировать цены и пороги?',
          a: 'Только владелец может редактировать параметры склада. При входе как владелец нажмите «Редактировать склад» — откроется инлайн-редактирование цен и порогов. Флористы могут только принимать поставки и списывать стебли.',
        },
      ],
    },
    {
      title: 'Советы и горячие клавиши',
      items: [
        {
          q: 'Как обновить цены в конструкторе букетов?',
          a: 'Нажмите «Обновить склад» над поиском цветов на Шаге 2. Это перезагрузит актуальные количества и цены из базы данных без выхода из формы заказа.',
        },
        {
          q: 'Можно ли ввести количество напрямую?',
          a: 'Да! Нажмите на число между кнопками − и + в корзине букета. Введите нужное количество и нажмите в другое место (или Enter). Новое количество применится. Введите 0, чтобы удалить позицию.',
        },
        {
          q: 'Что будет, если закрыть приложение во время создания заказа?',
          a: 'Если есть несохранённые данные (выбран клиент, добавлены цветы или написан запрос), браузер предупредит перед закрытием. Данные НЕ сохраняются на сервере до нажатия «Создать заказ» на Шаге 4. Если закроете — придётся начать заново.',
        },
        {
          q: 'Как выйти из приложения?',
          a: 'Нажмите «Выход» в верхней панели навигации. Вы вернётесь на экран ввода PIN. Сессия не сохраняется — при следующем входе нужно будет ввести PIN снова.',
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
