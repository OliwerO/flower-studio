import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AskBlossomLauncher from '../components/AskBlossomLauncher.jsx';

vi.mock('../api/client.js', () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import client from '../api/client.js';

const t = { tabAssistant: 'Assistant', assistantPlaceholder: 'Ask…', assistantSend: 'Ask', assistantThinking: '…', assistantError: 'err', assistantEmpty: 'empty', assistantHistory: 'Chats', assistantNewChat: '+ New', assistantNoHistory: 'none', assistantUntitled: 'Untitled', assistantRename: 'Rename', assistantDelete: 'Delete', assistantDeleteConfirm: 'Delete?' };

beforeEach(() => { vi.clearAllMocks(); client.get.mockResolvedValue({ data: [] }); });

describe('AskBlossomLauncher', () => {
  it('shows a FAB and no panel initially', () => {
    render(<AskBlossomLauncher t={t} />);
    expect(screen.getByLabelText('Assistant')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask…')).not.toBeInTheDocument();
  });

  it('renders the gradient FAB with the Blossom-bubble flower-AI mark', () => {
    render(<AskBlossomLauncher t={t} />);
    const fab = screen.getByLabelText('Assistant');
    // gradient button treatment (owner-chosen), not the old flat brand-600
    expect(fab.className).toContain('bg-gradient-to-br');
    expect(fab.className).not.toContain('bg-brand-600');
    // the "Blossom bubble" mark = a chat-bubble path + a bloom (brand-200 petals)
    expect(fab.querySelector('path[d^="M6.2 3.4"]')).toBeTruthy();
    expect(fab.querySelector('circle[fill="#fbcfe8"]')).toBeTruthy();
  });

  it('opens the panel on FAB click and closes on ✕', async () => {
    render(<AskBlossomLauncher t={t} />);
    fireEvent.click(screen.getByLabelText('Assistant'));
    expect(await screen.findByPlaceholderText('Ask…')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Ask…')).not.toBeInTheDocument());
  });
});
