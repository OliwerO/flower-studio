// Intake parser — converts pasted text (customer messages, Flowwow emails) into
// structured order drafts. Like an OCR + data-entry station: raw input comes in,
// structured form data goes out. The florist reviews and corrects before submitting.

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Parse freeform text (pasted messages from any channel) into a draft order.
 * Uses Claude Haiku to extract structured data from messy multilingual input.
 *
 * @param {string} text - Raw pasted text (may contain multiple messages)
 * @param {Array} stockItems - Active stock items for flower matching
 * @returns {object} Parsed draft with customer, items, delivery info
 */
export async function parseRawText(text, stockItems) {
  const stockNames = stockItems.map(s => s['Display Name']).filter(Boolean);

  const systemPrompt = `You are an order intake parser for a flower studio in Krakow, Poland.
Extract order information from customer messages. Messages may be in Russian, Ukrainian, Polish, English, or Turkish.
Multiple messages may be pasted together.

Available flowers in stock:
${stockNames.join(', ')}

Return a JSON object with this exact structure (use null for missing fields, not empty strings):
{
  "customer": {
    "name": "customer name or null",
    "phone": "phone number or null",
    "email": "email or null",
    "instagram": "instagram handle or null"
  },
  "items": [
    { "description": "flower/product description", "quantity": 1 }
  ],
  "delivery": {
    "address": "delivery address or null",
    "recipientName": "recipient name or null (often different from customer for gift orders)",
    "recipientPhone": "recipient phone or null",
    "date": "YYYY-MM-DD or null",
    "time": "time text as-is or null (e.g. 'after 17:00', '10-12')",
    "cardText": "greeting card text or null"
  },
  "notes": "any special instructions or null",
  "originalRequest": "the customer's exact words describing what they want"
}

Rules:
- "originalRequest" should capture the customer's flower/bouquet request in their own words
- If the customer says "florist choice" or equivalent, put that in originalRequest
- Quantities default to 1 if not specified
- Match flower descriptions to available stock names when possible
- Keep greeting card text in its original language (never translate)
- Phone numbers: preserve as-is with country code if present
- Instagram: extract from URLs like instagram.com/handle or @handle
- Return ONLY valid JSON, no markdown fences, no commentary`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const content = response.content[0]?.text || '';
    // Strip markdown fences if the model wraps in ```json
    const jsonStr = content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('[INTAKE] AI parse failed:', err.message);
    // Graceful fallback — return raw text as the request
    return {
      customer: { name: null, phone: null, email: null, instagram: null },
      items: [],
      delivery: { address: null, recipientName: null, recipientPhone: null, date: null, time: null, cardText: null },
      notes: null,
      originalRequest: text,
    };
  }
}

/**
 * Parse a Flowwow order email using regex patterns first, then AI fallback.
 * Flowwow emails follow a consistent Russian-language structure with section headers.
 *
 * @param {string} emailBody - Pasted Flowwow email text
 * @param {Array} stockItems - Active stock items for flower matching
 * @returns {object} Parsed draft with Flowwow-specific fields pre-set
 */
export async function parseFlowwowEmail(emailBody, stockItems) {
  const result = {
    customer: { name: null, phone: null, email: null, instagram: null },
    items: [],
    delivery: { address: null, recipientName: null, recipientPhone: null, date: null, time: null, cardText: null },
    notes: null,
    originalRequest: '',
    flowwowOrderId: null,
    totalPrice: null,
    deliveryFee: null,
  };

  try {
    // Order ID
    const orderMatch = emailBody.match(/Заказ\s*[№#]?\s*(\d+)/i);
    if (orderMatch) result.flowwowOrderId = orderMatch[1];

    // Delivery time window — "в 11:00 — 14:00" or "в 11:00-14:00"
    const timeMatch = emailBody.match(/в\s+(\d{1,2}:\d{2})\s*[—–\-]\s*(\d{1,2}:\d{2})/);
    if (timeMatch) result.delivery.time = `${timeMatch[1]}-${timeMatch[2]}`;

    // Delivery date — look for date patterns near time or in header
    const dateMatch = emailBody.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
      result.delivery.date = `${year}-${month}-${day}`;
    }

    // Address — text block between time/date line and "Комментарий"
    const addressMatch = emailBody.match(/(?:Адрес|адрес)[:\s]*(.+?)(?=\n\s*(?:Комментарий|Коммент|Получатель|Отправитель))/is);
    if (addressMatch) result.delivery.address = addressMatch[1].trim();

    // Comment/notes
    const commentMatch = emailBody.match(/Комментарий[:\s]*(.+?)(?=\n\s*(?:Отправитель|Получатель|Состав|Позвонить|$))/is);
    if (commentMatch) result.notes = commentMatch[1].trim();

    // Recipient — between "Получатель" and next section
    const recipientMatch = emailBody.match(/Получатель[:\s]*(.+?)(?=\n\s*(?:Позвонить|Отправитель|Телефон|Комментарий|Состав|$))/is);
    if (recipientMatch) result.delivery.recipientName = recipientMatch[1].trim();

    // Sender/customer — between "Отправитель" and next section
    const senderMatch = emailBody.match(/Отправитель[:\s]*(.+?)(?=\n\s*(?:Позвонить|Получатель|Телефон|Комментарий|Состав|$))/is);
    if (senderMatch) result.customer.name = senderMatch[1].trim();

    // Phone numbers — "Позвонить" links or explicit phone patterns
    const phoneMatches = emailBody.match(/(?:Позвонить|Телефон|тел)[:\s]*([+\d\s\-()]{7,})/gi);
    if (phoneMatches) {
      // First phone → recipient, second → sender (Flowwow convention)
      const phones = phoneMatches.map(m => m.replace(/(?:Позвонить|Телефон|тел)[:\s]*/i, '').trim());
      if (phones[0]) result.delivery.recipientPhone = phones[0];
      if (phones[1]) result.customer.phone = phones[1];
    }

    // Line items — "Product name    N × price PLN" or similar patterns
    // Flowwow formats vary: "Тюльпан лавандовый 9 шт. × 1" or "Tulip lavender — 120 PLN × 1"
    const itemPattern = /(.+?)\s*(?:(\d+)\s*(?:шт\.?\s*)?[×x]\s*(\d+)|[×x]\s*(\d+)\s*(?:шт\.?)?|(\d+)\s*шт\.?)/gi;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(emailBody)) !== null) {
      const desc = itemMatch[1].trim();
      // Skip section headers and non-item lines
      if (/Заказ|Доставка|Итого|Получатель|Отправитель|Комментарий|Позвонить|Адрес/i.test(desc)) continue;
      const qty = Number(itemMatch[2] || itemMatch[4] || itemMatch[5] || 1);
      if (desc.length > 2 && desc.length < 100) {
        result.items.push({ description: desc, quantity: qty });
      }
    }

    // Delivery fee
    const feeMatch = emailBody.match(/Доставка[:\s]*(\d+)\s*(?:PLN|zł|зл)/i);
    if (feeMatch) result.deliveryFee = Number(feeMatch[1]);

    // Total price
    const totalMatch = emailBody.match(/Итого\s*(?:оплачено)?[:\s]*(\d+)\s*(?:PLN|zł|зл)/i);
    if (totalMatch) result.totalPrice = Number(totalMatch[1]);

    // Build originalRequest from items
    result.originalRequest = result.items
      .map(i => `${i.quantity}× ${i.description}`)
      .join(', ') || emailBody.substring(0, 200);

  } catch (err) {
    console.error('[INTAKE] Flowwow regex parsing error:', err.message);
  }

  // If regex extracted very little, fall back to AI
  if (result.items.length === 0 && !result.delivery.recipientName) {
    console.log('[INTAKE] Flowwow regex found too little, falling back to AI');
    const aiResult = await parseRawText(emailBody, stockItems);
    // Merge: keep Flowwow-specific fields if we got them, fill rest from AI
    return {
      ...aiResult,
      flowwowOrderId: result.flowwowOrderId || null,
      totalPrice: result.totalPrice || null,
      deliveryFee: result.deliveryFee || null,
      // Prefer regex-extracted delivery fields if present
      delivery: {
        ...aiResult.delivery,
        ...(result.delivery.time ? { time: result.delivery.time } : {}),
        ...(result.delivery.date ? { date: result.delivery.date } : {}),
        ...(result.delivery.address ? { address: result.delivery.address } : {}),
        ...(result.delivery.recipientName ? { recipientName: result.delivery.recipientName } : {}),
        ...(result.delivery.recipientPhone ? { recipientPhone: result.delivery.recipientPhone } : {}),
      },
    };
  }

  return result;
}

/**
 * Match extracted item descriptions to actual stock items.
 * Two-pass: exact match first, then AI for remaining unmatched items.
 *
 * @param {Array} extractedItems - Items from parser: [{ description, quantity }]
 * @param {Array} stockItems - Active stock items from Airtable
 * @returns {Array} Matched lines with stock links and confidence levels
 */
export async function matchStockItems(extractedItems, stockItems) {
  if (!extractedItems?.length) return [];

  const results = [];
  const unmatched = [];

  // Build lookup maps — like a parts catalog index
  const byNameLower = new Map();
  for (const s of stockItems) {
    const name = (s['Display Name'] || '').toLowerCase();
    if (name) byNameLower.set(name, s);
  }

  // Pass 1: exact match (case-insensitive)
  for (const item of extractedItems) {
    const desc = (item.description || '').toLowerCase().trim();
    const match = byNameLower.get(desc);
    if (match) {
      results.push({
        stockItemId: match.id,
        flowerName: match['Display Name'],
        quantity: item.quantity || 1,
        costPricePerUnit: Number(match['Current Cost Price'] || 0),
        sellPricePerUnit: Number(match['Current Sell Price'] || 0),
        confidence: 'high',
      });
    } else {
      unmatched.push(item);
    }
  }

  // Pass 2: AI matching for remaining items
  if (unmatched.length > 0 && stockItems.length > 0) {
    try {
      const stockList = stockItems.map(s => ({
        id: s.id,
        name: s['Display Name'],
        category: s.Category || '',
      }));

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: `You match flower/product descriptions to a stock catalog.
For each description, find the best matching stock item or say "none".

Stock catalog:
${stockList.map(s => `- ${s.name} (${s.category}) [id: ${s.id}]`).join('\n')}

Return a JSON array with one object per input item:
[{ "inputDescription": "...", "matchedId": "recXXX" or null, "confidence": "high" or "low" }]

Rules:
- Match across languages (Russian/Ukrainian/Polish/English names for same flower)
- "high" confidence: clearly the same flower (e.g., "красные розы" → "Rose Red")
- "low" confidence: probable but uncertain match
- null matchedId: no reasonable match found
- Return ONLY valid JSON, no markdown fences`,
        messages: [{
          role: 'user',
          content: `Match these items:\n${unmatched.map(u => `- "${u.description}" (qty: ${u.quantity})`).join('\n')}`,
        }],
      });

      const content = response.content[0]?.text || '[]';
      const jsonStr = content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const aiMatches = JSON.parse(jsonStr);

      const stockById = new Map(stockItems.map(s => [s.id, s]));

      for (let i = 0; i < unmatched.length; i++) {
        const aiMatch = aiMatches[i];
        const stockItem = aiMatch?.matchedId ? stockById.get(aiMatch.matchedId) : null;

        results.push({
          stockItemId: stockItem?.id || null,
          flowerName: stockItem ? stockItem['Display Name'] : unmatched[i].description,
          quantity: unmatched[i].quantity || 1,
          costPricePerUnit: stockItem ? Number(stockItem['Current Cost Price'] || 0) : 0,
          sellPricePerUnit: stockItem ? Number(stockItem['Current Sell Price'] || 0) : 0,
          confidence: stockItem ? (aiMatch.confidence || 'low') : 'none',
        });
      }
    } catch (err) {
      console.error('[INTAKE] AI stock matching failed:', err.message);
      // Return unmatched items as-is with no confidence
      for (const item of unmatched) {
        results.push({
          stockItemId: null,
          flowerName: item.description,
          quantity: item.quantity || 1,
          costPricePerUnit: 0,
          sellPricePerUnit: 0,
          confidence: 'none',
        });
      }
    }
  }

  return results;
}
