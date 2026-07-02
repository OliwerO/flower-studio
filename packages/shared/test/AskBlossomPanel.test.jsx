import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AskBlossomPanel from '../components/AskBlossomPanel.jsx';

vi.mock('../api/client.js', () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
// FeedbackModal uses resizeImageBlob; mock it so jsdom canvas is not needed.
vi.mock('../utils/imageResize.js', () => ({ resizeImageBlob: vi.fn().mockResolvedValue(new Blob()) }));
// Control the app language for the handoff-label tests (Explorer v2 #497).
const { langRef } = vi.hoisted(() => ({ langRef: { current: 'ru' } }));
vi.mock('../context/LanguageContext.jsx', () => ({
  useLanguage: () => ({ lang: langRef.current, setLang: () => {} }),
}));
import client from '../api/client.js';

const t = {
  assistantPlaceholder: 'Спросите…', assistantSend: 'Спросить', assistantThinking: 'Думаю…',
  assistantError: 'Ошибка', assistantEmpty: 'Задайте вопрос о ваших данных',
  assistantHistory: 'Чаты', assistantNewChat: '+ Новый чат', assistantNoHistory: 'Нет чатов',
  assistantUntitled: 'Без названия', assistantRename: 'Переименовать', assistantDelete: 'Удалить',
  assistantDeleteConfirm: 'Удалить?', assistantReport: 'Сообщить о проблеме',
  // FeedbackModal keys
  reportTitle: 'Отчёт', reportPlaceholder: 'Опишите…', reportSend: 'Отправить',
  reportThinking: 'Думаю…', reportAddScreenshot: 'Добавить скриншот',
  reportPreviewTitle: 'Предпросмотр', reportCorrect: 'Исправить', reportConfirm: 'Опубликовать',
  reportSuccess: 'Готово!', reportError: 'Ошибка', reportRetry: 'Попробовать снова',
  reportExpired: 'Сессия устарела',
};

beforeEach(() => { vi.clearAllMocks(); langRef.current = 'ru'; client.get.mockResolvedValue({ data: [] }); });

describe('AskBlossomPanel', () => {
  it('sends a question and renders the markdown answer', async () => {
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: '**142** заказа', toolResults: [] } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'Сколько заказов?' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('Сколько заказов?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('142')).toBeInTheDocument()); // bold rendered by markdown
    expect(client.post).toHaveBeenCalledWith('/assistant/message', { sessionId: null, message: 'Сколько заказов?' });
  });

  it('reuses the sessionId on the second question', async () => {
    client.post
      .mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'a', toolResults: [] } })
      .mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'b', toolResults: [] } });
    render(<AskBlossomPanel t={t} />);
    const input = screen.getByPlaceholderText('Спросите…');
    fireEvent.change(input, { target: { value: 'q1' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('a');
    fireEvent.change(input, { target: { value: 'q2' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('b');
    expect(client.post).toHaveBeenLastCalledWith('/assistant/message', { sessionId: 's1', message: 'q2' });
  });

  it('renders a GFM markdown table as a real <table> (not raw pipes)', async () => {
    const answer = '| Status | Count |\n| --- | --- |\n| New | 12 |\n| Ready | 5 |';
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer, toolResults: [] } });
    const { container } = render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'breakdown' } });
    fireEvent.click(screen.getByText('Спросить'));
    await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
    expect(container.querySelectorAll('th')).toHaveLength(2); // GFM table header cells
    expect(screen.getByRole('cell', { name: 'New' })).toBeInTheDocument();
    expect(screen.queryByText('| Status | Count |')).not.toBeInTheDocument(); // not raw pipes
  });

  it('shows an error bubble when the request fails', async () => {
    client.post.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('lists saved conversations on mount', async () => {
    client.get.mockResolvedValueOnce({ data: [{ id: 'c1', title: 'May orders', updatedAt: 'x', messageCount: 2 }] });
    render(<AskBlossomPanel t={t} />);
    expect(await screen.findByText('May orders')).toBeInTheDocument();
  });

  it('reopens a conversation when its row is clicked', async () => {
    client.get
      .mockResolvedValueOnce({ data: [{ id: 'c1', title: 'May orders', updatedAt: 'x', messageCount: 2 }] }) // mount list
      .mockResolvedValueOnce({ data: { id: 'c1', title: 'May orders', messages: [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }] } }); // load
    render(<AskBlossomPanel t={t} />);
    fireEvent.click(await screen.findByText('May orders'));
    expect(await screen.findByText('q1')).toBeInTheDocument();
    expect(await screen.findByText('a1')).toBeInTheDocument();
    expect(client.get).toHaveBeenLastCalledWith('/assistant/conversations/c1');
  });

  it('New chat clears the current conversation', async () => {
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'a', toolResults: [] } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('a');
    // Two "New chat" buttons exist by design: the desktop sidebar + the mobile
    // toolbar (CSS-toggled via sm: — jsdom renders both). Either clears the chat.
    fireEvent.click(screen.getAllByText('+ Новый чат')[0]);
    expect(screen.queryByText('a')).not.toBeInTheDocument();
  });

  it('refreshes the history list after sending', async () => {
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'a', toolResults: [] } });
    render(<AskBlossomPanel t={t} />);
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1)); // mount
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('a');
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2)); // refreshed after send
  });

  it('deletes a conversation via two-step confirm', async () => {
    client.get.mockResolvedValueOnce({ data: [{ id: 'c1', title: 'May orders', updatedAt: 'x', messageCount: 2 }] });
    client.delete.mockResolvedValueOnce({ status: 204 });
    render(<AskBlossomPanel t={t} />);
    await screen.findByText('May orders');
    fireEvent.click(screen.getByLabelText('Удалить')); // trash → arms confirm
    fireEvent.click(screen.getByText('Удалить?'));      // confirm
    await waitFor(() => expect(client.delete).toHaveBeenCalledWith('/assistant/conversations/c1'));
  });
});

// ── Open in Orders (open_orders_view signal tool) ─────────────────────────────

describe('AskBlossomPanel — Open in Orders', () => {
  it('renders an Open in Orders button when a message carries an open_orders_view tool result', async () => {
    const toolResults = [{
      name: 'open_orders_view',
      input: { paymentStatus: 'Unpaid' },
      output: { view: 'orders', filter: { paymentStatus: 'Unpaid' }, label: 'Неоплаченные заказы' },
    }];
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'Вот неоплаченные заказы', toolResults } });
    const onOpenOrders = vi.fn();
    render(<AskBlossomPanel t={t} onOpenOrders={onOpenOrders} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'unpaid?' } });
    fireEvent.click(screen.getByText('Спросить'));
    const btn = await screen.findByText('Неоплаченные заказы');
    fireEvent.click(btn);
    expect(onOpenOrders).toHaveBeenCalledWith({ paymentStatus: 'Unpaid' });
  });

  it('does not render the button when onOpenOrders prop is absent', async () => {
    const toolResults = [{
      name: 'open_orders_view',
      input: {},
      output: { view: 'orders', filter: {}, label: 'Отфильтрованные заказы' },
    }];
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'ответ', toolResults } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('ответ');
    expect(screen.queryByText('Отфильтрованные заказы')).not.toBeInTheDocument();
  });

  it('does not render the button when no tool result is open_orders_view', async () => {
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'просто ответ', toolResults: [{ name: 'query_orders', input: {}, output: {} }] } });
    render(<AskBlossomPanel t={t} onOpenOrders={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'q' } });
    fireEvent.click(screen.getByText('Спросить'));
    await screen.findByText('просто ответ');
    expect(screen.queryByText('Отфильтрованные заказы')).not.toBeInTheDocument();
  });
});

// ── Bilingual handoff labels + both buttons + persist-on-reopen (Explorer v2 #497) ──

describe('AskBlossomPanel — bilingual handoff labels', () => {
  const bothLabels = { view: 'orders', filter: { paymentStatus: 'Unpaid' }, label: 'Неоплаченные заказы', labelEn: 'Unpaid orders' };

  it('shows the English label when the app is in English', async () => {
    langRef.current = 'en';
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'ans', toolResults: [{ name: 'open_orders_view', output: bothLabels }] } });
    render(<AskBlossomPanel t={t} onOpenOrders={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'unpaid?' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('Unpaid orders')).toBeInTheDocument();
    expect(screen.queryByText('Неоплаченные заказы')).not.toBeInTheDocument();
  });

  it('shows the Russian label when the app is in Russian', async () => {
    langRef.current = 'ru';
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'ans', toolResults: [{ name: 'open_orders_view', output: bothLabels }] } });
    render(<AskBlossomPanel t={t} onOpenOrders={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'unpaid?' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('Неоплаченные заказы')).toBeInTheDocument();
    expect(screen.queryByText('Unpaid orders')).not.toBeInTheDocument();
  });

  it('renders BOTH buttons when a message carries both signals', async () => {
    const spec = { entity: 'orders', filters: [], sort: [] };
    const toolResults = [
      { name: 'open_orders_view', output: { view: 'orders', filter: {}, label: 'Заказы', labelEn: 'Orders' } },
      { name: 'open_explorer_view', output: { view: 'explorer', spec, label: 'Заказы (данные)', labelEn: 'Orders (data)' } },
    ];
    langRef.current = 'en';
    client.post.mockResolvedValueOnce({ data: { sessionId: 's1', answer: 'ans', toolResults } });
    const onOpenOrders = vi.fn();
    const onOpenExplorer = vi.fn();
    render(<AskBlossomPanel t={t} onOpenOrders={onOpenOrders} onOpenExplorer={onOpenExplorer} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'orders' } });
    fireEvent.click(screen.getByText('Спросить'));
    fireEvent.click(await screen.findByText('Orders'));
    fireEvent.click(screen.getByText('Orders (data)'));
    expect(onOpenOrders).toHaveBeenCalledWith({});
    expect(onOpenExplorer).toHaveBeenCalledWith(spec);
  });

  it('keeps the handoff button when a saved conversation is reopened (toolResults survive projection)', async () => {
    // Simulates the new toDisplayTurns output: the assistant turn carries the
    // reconstructed signal toolResults, so the button re-renders on reopen.
    client.get
      .mockResolvedValueOnce({ data: [{ id: 'c1', title: 'Unpaid', updatedAt: 'x', messageCount: 2 }] }) // mount list
      .mockResolvedValueOnce({ data: { id: 'c1', title: 'Unpaid', messages: [
        { role: 'user', text: 'unpaid?' },
        { role: 'assistant', text: 'ans', toolResults: [{ name: 'open_orders_view', output: bothLabels }] },
      ] } });
    const onOpenOrders = vi.fn();
    render(<AskBlossomPanel t={t} onOpenOrders={onOpenOrders} />);
    fireEvent.click(await screen.findByText('Unpaid'));
    const btn = await screen.findByText('Неоплаченные заказы'); // ru default
    fireEvent.click(btn);
    expect(onOpenOrders).toHaveBeenCalledWith({ paymentStatus: 'Unpaid' });
  });
});

// ── Report button (Part A) ────────────────────────────────────────────────────

describe('AskBlossomPanel — report button', () => {
  it('shows "Сообщить о проблеме" button when reporterRole is provided', () => {
    render(<AskBlossomPanel t={t} reporterRole="owner" reporterName="Owner" appArea="dashboard" />);
    expect(screen.getByText('Сообщить о проблеме')).toBeInTheDocument();
  });

  it('does not show the report button when reporterRole is absent', () => {
    render(<AskBlossomPanel t={t} />);
    expect(screen.queryByText('Сообщить о проблеме')).not.toBeInTheDocument();
  });

  it('clicking report button opens FeedbackModal', async () => {
    render(<AskBlossomPanel t={t} reporterRole="owner" reporterName="Owner" appArea="dashboard" />);
    fireEvent.click(screen.getByText('Сообщить о проблеме'));
    expect(await screen.findByText('Отчёт')).toBeInTheDocument(); // FeedbackModal header (reportTitle)
  });

  it('closing FeedbackModal hides it', async () => {
    render(<AskBlossomPanel t={t} reporterRole="owner" reporterName="Owner" appArea="dashboard" />);
    fireEvent.click(screen.getByText('Сообщить о проблеме'));
    await screen.findByText('Отчёт');
    // Click the close (✕) button inside the FeedbackModal
    const closeBtn = screen.getAllByRole('button').find(b => b.getAttribute('aria-label') === null && b.textContent === '');
    // FeedbackModal renders a close button; click the backdrop instead (simpler)
    const backdrop = document.querySelector('.fixed.inset-0.z-50 > .absolute');
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByText('Отчёт')).not.toBeInTheDocument());
  });
});
