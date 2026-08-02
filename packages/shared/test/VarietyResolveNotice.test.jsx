// @vitest-environment jsdom
//
// VarietyResolveNotice — "is this a flower you already have?" for the two
// receive forms (#604, rows 1–2 of the entry-surface inventory).
//
// Receiving is the screen used most often and under the most time pressure,
// and until now its whole identity check was "the name is not empty" — Type
// was optional and silently fell back to whatever was typed as the name, so
// `Pink Peonies` produced a flower whose Type is `Pink Peonies`. That is #562
// reproduced exactly; prod carries five such cards.
//
// The server-side door (#603) stops the duplicate being stored. This is the
// screen's half: say which flower she is about to receive into, and make
// creating a genuinely new one a deliberate act — because the confirmed path
// sends `newVariety: true`, which bypasses that door.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VarietyResolveNotice from '../components/VarietyResolveNotice.jsx';

const PEONY_PINK = {
  id: 'de-peony-pink', 'Display Name': 'Peony Pink',
  Type: 'Peony', Colour: 'Pink', Size: null, Cultivar: null,
};
const PEONY_WHITE_60 = {
  id: 'de-peony-white-60', 'Display Name': 'Peony White 60cm',
  Type: 'Peony', Colour: 'White', Size: 60, Cultivar: null,
};
const DAHLIA_BATCH = {
  id: 'batch-dahlia', 'Display Name': 'Dahlia Coral (2026-07-23)',
  Type: 'Dahlia', Colour: 'Coral', Size: null, Cultivar: null,
};
const STOCK = [PEONY_PINK, PEONY_WHITE_60, DAHLIA_BATCH];

const t = {
  varietyNone: 'не выбран', varietyLinked: 'из карточки склада', newVariety: 'Новый сорт',
  newVarietyConfirm: 'Такого цветка ещё нет. Создать?', newVarietyCreate: 'Создать новый',
  varietyTypeRequired: 'Укажите тип', cancel: 'Отмена',
};

function setup(form, extra = {}) {
  const onConfirmedChange = vi.fn();
  render(
    <VarietyResolveNotice
      form={form}
      stockItems={STOCK}
      confirmed={false}
      onConfirmedChange={onConfirmedChange}
      t={t}
      {...extra}
    />,
  );
  return { onConfirmedChange };
}

const badge = () => screen.getByTestId('vrn-badge').textContent;

describe('VarietyResolveNotice', () => {
  it('says nothing is chosen while Type is blank, and names what is missing', () => {
    setup({ typeName: '', colour: 'Pink' });
    expect(badge()).toContain('не выбран');
    expect(screen.getByTestId('vrn-hint')).toHaveTextContent('Укажите тип');
    expect(screen.queryByTestId('vrn-confirm')).not.toBeInTheDocument();
  });

  it('names the flower she is receiving into when it resolves', () => {
    setup({ typeName: 'Peony', colour: 'Pink' });
    expect(badge()).toContain('из карточки склада');
    expect(screen.getByTestId('vrn-resolved')).toHaveTextContent('Peony Pink');
    expect(screen.queryByTestId('vrn-confirm')).not.toBeInTheDocument();
  });

  it('is null-aware — a blank Colour is not a wildcard (ADR-0006)', () => {
    // Peony with NO colour is a different flower from Peony Pink.
    setup({ typeName: 'Peony', colour: '' });
    expect(badge()).toContain('Новый сорт');
  });

  it('treats a flower held only as a dated delivery as one she has', () => {
    // Prompting "create new?" while she is holding the stems trains her to
    // click through the prompt that matters.
    setup({ typeName: 'Dahlia', colour: 'Coral' });
    expect(badge()).toContain('из карточки склада');
  });

  it('asks before creating a flower that does not exist, naming what it will create', () => {
    const { onConfirmedChange } = setup({ typeName: 'Ranunculus', colour: 'Peach' });
    expect(badge()).toContain('Новый сорт');
    expect(screen.getByTestId('vrn-prompt')).toHaveTextContent('Ranunculus Peach');
    expect(onConfirmedChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('vrn-confirm'));
    expect(onConfirmedChange).toHaveBeenCalledWith(true);
  });

  it('withdraws an existing confirmation as soon as the identity changes', () => {
    // She must re-see what she is creating; a stale confirm is how the wrong
    // flower gets created silently.
    const onConfirmedChange = vi.fn();
    const { rerender } = render(
      <VarietyResolveNotice
        form={{ typeName: 'Ranunculus', colour: 'Peach' }}
        stockItems={STOCK} confirmed onConfirmedChange={onConfirmedChange} t={t}
      />,
    );
    rerender(
      <VarietyResolveNotice
        form={{ typeName: 'Ranunculus', colour: 'Coral' }}
        stockItems={STOCK} confirmed onConfirmedChange={onConfirmedChange} t={t}
      />,
    );
    expect(onConfirmedChange).toHaveBeenCalledWith(false);
  });

  it('withdraws a confirmation when the identity comes to match something she has', () => {
    const onConfirmedChange = vi.fn();
    const { rerender } = render(
      <VarietyResolveNotice
        form={{ typeName: 'Ranunculus', colour: 'Peach' }}
        stockItems={STOCK} confirmed onConfirmedChange={onConfirmedChange} t={t}
      />,
    );
    rerender(
      <VarietyResolveNotice
        form={{ typeName: 'Peony', colour: 'Pink' }}
        stockItems={STOCK} confirmed onConfirmedChange={onConfirmedChange} t={t}
      />,
    );
    expect(onConfirmedChange).toHaveBeenCalledWith(false);
  });

  it('never offers the confirm against an empty catalogue', () => {
    // A failed /stock fetch makes every flower read as new; confirming then
    // sends newVariety:true and bypasses the server's own duplicate guard.
    render(
      <VarietyResolveNotice
        form={{ typeName: 'Peony', colour: 'Pink' }}
        stockItems={[]} confirmed={false} onConfirmedChange={() => {}} t={t}
      />,
    );
    expect(screen.queryByTestId('vrn-confirm')).not.toBeInTheDocument();
  });

  it('reports the resolution upward so the host can post the right thing', () => {
    const onResolve = vi.fn();
    setup({ typeName: 'Peony', colour: 'Pink' }, { onResolve });
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'linked', resolvedName: 'Peony Pink', match: PEONY_PINK }),
    );
  });

  it('reports a new flower with the name it composed, not a typed one', () => {
    const onResolve = vi.fn();
    setup({ typeName: 'Ranunculus', colour: 'Peach', sizeCm: '50' }, { onResolve });
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'new', resolvedName: 'Ranunculus Peach 50cm', match: null }),
    );
  });
});
