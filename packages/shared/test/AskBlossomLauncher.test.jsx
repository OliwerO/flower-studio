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

  it('opens the panel on FAB click and closes on ✕', async () => {
    render(<AskBlossomLauncher t={t} />);
    fireEvent.click(screen.getByLabelText('Assistant'));
    expect(await screen.findByPlaceholderText('Ask…')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Ask…')).not.toBeInTheDocument());
  });
});
