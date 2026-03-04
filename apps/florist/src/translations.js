// All user-facing strings in one place.
// To switch from English to Russian, edit only this file.
// Components import `t` and use t.keyName — no i18n library needed for a single-language app.

const t = {
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

  // Toast
  success:          'Done!',
  error:            'Error',
  dismiss:          'Dismiss',
};

export default t;
