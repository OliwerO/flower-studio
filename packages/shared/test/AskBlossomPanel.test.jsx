import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AskBlossomPanel from '../components/AskBlossomPanel.jsx';

vi.mock('../api/client.js', () => ({ default: { post: vi.fn() } }));
import client from '../api/client.js';

const t = { assistantPlaceholder: 'Спросите…', assistantSend: 'Спросить', assistantThinking: 'Думаю…', assistantError: 'Ошибка', assistantEmpty: 'Задайте вопрос о ваших данных' };

beforeEach(() => vi.clearAllMocks());

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

  it('shows an error bubble when the request fails', async () => {
    client.post.mockRejectedValueOnce({ response: { data: { error: 'boom' } } });
    render(<AskBlossomPanel t={t} />);
    fireEvent.change(screen.getByPlaceholderText('Спросите…'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Спросить'));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
