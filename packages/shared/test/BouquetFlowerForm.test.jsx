// BouquetFlowerForm — the one "add a flower to a bouquet" form (#605).
//
// What these pin, in order of how badly each one bit in production:
//   1. the typed query never becomes the flower's name or Type (owner, 2026-07-30:
//      typing `DA` while looking for Dahlia produced a flower named+typed `DA`);
//   2. a flower she already has is reused silently — no confirm, no duplicate;
//   3. a flower that exists only as a dated delivery counts as existing;
//   4. creating a genuinely new Variety takes an explicit confirm, and only that
//      path sends `newVariety: true` (which bypasses the server guard, #603);
//   5. a failed create never silently appends an unlinked line (pitfall #5).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BouquetFlowerForm from '../components/BouquetFlowerForm.jsx';

const PEONY_PINK_60 = {
  id: 'de-peony-pink-60', 'Display Name': 'Peony Pink 60cm',
  Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null,
  'Current Quantity': 0, 'Current Cost Price': 4, 'Current Sell Price': 12,
};
const PEONY_WHITE = {
  id: 'de-peony-white', 'Display Name': 'Peony White',
  Type: 'Peony', Colour: 'White', Size: null, Cultivar: null,
  'Current Quantity': 5, 'Current Cost Price': 5, 'Current Sell Price': 15,
};
const DAHLIA_CORAL_BATCH = {
  id: 'batch-dahlia', 'Display Name': 'Dahlia Coral (22.Jul.)',
  Type: 'Dahlia', Colour: 'Coral', Size: null, Cultivar: null,
  'Current Quantity': 8, 'Current Cost Price': 7, 'Current Sell Price': 21,
};
const STOCK = [PEONY_PINK_60, PEONY_WHITE, DAHLIA_CORAL_BATCH];

const t = {
  varietyNone: 'не выбран', varietyLinked: 'из карточки склада', newVariety: 'Новый сорт',
  newVarietyConfirm: 'Такого цветка ещё нет. Создать новый сорт?', newVarietyCreate: 'Создать новый',
  varietySuggestions: 'У вас уже есть', varietyRefine: 'Уточнить', cancel: 'Отмена',
  addToCart: 'Добавить', error: 'Ошибка', flowerType: 'Тип', flowerColour: 'Цвет',
};

let apiClient, onCreated, onCancel, showToast;
beforeEach(() => {
  apiClient = {
    patch: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: { id: 'de-new', 'Display Name': 'Ranunculus Peach' } }),
  };
  onCreated = vi.fn();
  onCancel = vi.fn();
  showToast = vi.fn();
});

function mount(props = {}) {
  return render(
    <BouquetFlowerForm
      seedQuery="" stockItems={STOCK} apiClient={apiClient} t={t}
      showToast={showToast} onCreated={onCreated} onCancel={onCancel}
      {...props}
    />,
  );
}

describe('the search query is a seed, never an identity', () => {
  it("the owner's own case: typing DA neither names nor types the flower", () => {
    mount({ seedQuery: 'DA' });
    expect(screen.getByTestId('nv-type')).toHaveValue('');
    expect(screen.getByTestId('bff-variety-badge')).toHaveTextContent('не выбран');
    expect(screen.getByTestId('bff-submit')).toBeDisabled();
  });

  it('decomposes a query against flowers that already exist', () => {
    mount({ seedQuery: 'peony pink 60' });
    expect(screen.getByTestId('nv-type')).toHaveValue('Peony');
    expect(screen.getByTestId('nv-colour')).toHaveValue('Pink');
    expect(screen.getByTestId('bff-variety-badge')).toHaveTextContent('из карточки склада');
  });

  it('shows the resolved card name, not what was typed', () => {
    mount({ seedQuery: 'peony pink 60' });
    expect(screen.getByTestId('bff-resolved-name')).toHaveTextContent('Peony Pink 60cm');
  });

  it('composes the name from the classification for a genuinely new flower', () => {
    mount({ seedQuery: 'Pink Peonies' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Ranunculus' } });
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'Peach' } });
    expect(screen.getByTestId('bff-resolved-name')).toHaveTextContent('Ranunculus Peach');
  });
});

describe('resolving an existing flower', () => {
  it('reuses it with no confirm, and hands createBouquetDemand the resolved card', async () => {
    mount({ seedQuery: 'peony pink 60', quantity: 3 });
    fireEvent.click(screen.getByTestId('bff-submit'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.queryByTestId('bff-new-variety-prompt')).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalled();          // reused, never created
    expect(onCreated.mock.calls[0][0].resolved).toBe(true);
    expect(onCreated.mock.calls[0][0].line.stockItemId).toBe('de-peony-pink-60');
  });

  it('treats a flower that exists only as a dated delivery as existing', async () => {
    mount({ seedQuery: 'dahlia coral' });
    expect(screen.getByTestId('bff-variety-badge')).toHaveTextContent('из карточки склада');

    fireEvent.click(screen.getByTestId('bff-submit'));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    // No prompt: she is holding the stems. It creates the undated demand row.
    expect(screen.queryByTestId('bff-new-variety-prompt')).toBeNull();
    expect(apiClient.post.mock.calls[0][1]).not.toHaveProperty('newVariety');
  });

  it('a suggestion chip fills the whole classification', () => {
    mount({ seedQuery: 'peony' });
    const chips = screen.getAllByTestId('bff-suggestion').map(c => c.textContent);
    expect(chips).toContain('Peony White');

    fireEvent.click(screen.getAllByTestId('bff-suggestion').find(c => c.textContent === 'Peony White'));
    expect(screen.getByTestId('nv-colour')).toHaveValue('White');
    expect(screen.getByTestId('bff-variety-badge')).toHaveTextContent('из карточки склада');
  });
});

describe('creating a genuinely new Variety', () => {
  it('raises the confirm instead of submitting, and names what will be created', () => {
    mount({ seedQuery: 'ranunculus peach' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Ranunculus' } });
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'Peach' } });
    fireEvent.click(screen.getByTestId('bff-submit'));

    const prompt = screen.getByTestId('bff-new-variety-prompt');
    expect(prompt).toHaveTextContent('Создать новый сорт?');
    expect(prompt).toHaveTextContent('Ranunculus Peach');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('confirming posts the classification with newVariety and the composed name', async () => {
    mount({ seedQuery: 'ranunculus peach' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Ranunculus' } });
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'Peach' } });
    fireEvent.click(screen.getByTestId('bff-submit'));
    fireEvent.click(screen.getByTestId('bff-new-variety-confirm'));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post.mock.calls[0][1]).toMatchObject({
      displayName: 'Ranunculus Peach',   // NOT the seed query
      typeName: 'Ranunculus',
      colour: 'Peach',
      newVariety: true,
    });
  });

  it('cancelling writes nothing and keeps everything she typed', () => {
    mount({ seedQuery: 'ranunculus peach' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Ranunculus' } });
    fireEvent.click(screen.getByTestId('bff-submit'));
    fireEvent.click(screen.getByTestId('bff-new-variety-cancel'));

    expect(screen.queryByTestId('bff-new-variety-prompt')).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId('nv-type')).toHaveValue('Ranunculus');
  });

  it('editing after raising the confirm withdraws it — she must re-see what she is creating', () => {
    mount({ seedQuery: 'ranunculus peach' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Ranunculus' } });
    fireEvent.click(screen.getByTestId('bff-submit'));
    expect(screen.getByTestId('bff-new-variety-prompt')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'Coral' } });
    expect(screen.queryByTestId('bff-new-variety-prompt')).toBeNull();
  });

  it('typing a Type that already exists takes the confirm away again', () => {
    mount({ seedQuery: 'ranunculus peach' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'peony' } });
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'WHITE' } });
    expect(screen.getByTestId('bff-variety-badge')).toHaveTextContent('из карточки склада');
  });
});

describe('failure and chrome', () => {
  it('a failed create surfaces the backend message and adds nothing', async () => {
    apiClient.post.mockRejectedValue({ response: { data: { error: 'Нет связи' } } });
    mount({ seedQuery: 'ranunculus peach' });
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Ranunculus' } });
    fireEvent.click(screen.getByTestId('bff-submit'));
    fireEvent.click(screen.getByTestId('bff-new-variety-confirm'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Нет связи', 'error'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId('bouquet-flower-form')).toBeInTheDocument(); // form stays open
  });

  it('dense mode hides the classification until it is the point', () => {
    mount({ seedQuery: 'peony pink 60', dense: true });
    expect(screen.queryByTestId('nv-type')).toBeNull();

    fireEvent.click(screen.getByTestId('bff-refine-toggle'));
    expect(screen.getByTestId('nv-type')).toBeInTheDocument();
  });

  it('dense mode opens the classification when the query could not be classified', () => {
    mount({ seedQuery: 'DA', dense: true });
    expect(screen.getByTestId('nv-type')).toBeInTheDocument();
  });

  it('optional fields appear only when the host asks for them', () => {
    const { rerender } = mount({ seedQuery: 'peony' });
    expect(screen.queryByTestId('bff-supplier')).toBeNull();

    rerender(
      <BouquetFlowerForm
        seedQuery="peony" stockItems={STOCK} apiClient={apiClient} t={t}
        showToast={showToast} onCreated={onCreated} onCancel={onCancel}
        fields={{ supplier: true, lotSize: true }} suppliers={['Zielona']}
      />,
    );
    expect(screen.getByTestId('bff-supplier')).toBeInTheDocument();
    expect(screen.getByTestId('bff-lot')).toBeInTheDocument();
  });

  it('suggests a sell price from cost without ever overwriting a typed one', () => {
    mount({ seedQuery: 'peony', targetMarkup: 3 });
    fireEvent.change(screen.getByTestId('bff-cost'), { target: { value: '5' } });
    fireEvent.blur(screen.getByTestId('bff-cost'));
    expect(screen.getByTestId('bff-sell')).toHaveValue(15);

    fireEvent.change(screen.getByTestId('bff-sell'), { target: { value: '20' } });
    fireEvent.change(screen.getByTestId('bff-cost'), { target: { value: '6' } });
    fireEvent.blur(screen.getByTestId('bff-cost'));
    expect(screen.getByTestId('bff-sell')).toHaveValue(20);
  });

  it('cancel is the host\'s business', () => {
    mount({ seedQuery: 'peony' });
    fireEvent.click(screen.getByTestId('bff-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
