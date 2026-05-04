import { useState, useEffect } from 'react';
import t from '../translations.js';
import client, { cachedGet } from '../api/client.js';
import { ConfigRow, ListEditor, Section } from './settings/SettingsPrimitives.jsx';
import { RateTypesEditor, FloristRatesEditor } from './settings/RateEditors.jsx';
import DriverSettingsSection from './settings/DriverSettingsSection.jsx';
import DeliveryZonesSection from './settings/DeliveryZonesSection.jsx';
import StorefrontCategoriesSection from './settings/StorefrontCategoriesSection.jsx';
import MarketingSpendSection from './settings/MarketingSpendSection.jsx';
import StockLossSection from './settings/StockLossSection.jsx';

export default function SettingsTab() {
  const [config, setConfig] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [backupName, setBackupName] = useState('');
  const [pinDrivers, setPinDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    cachedGet('/settings')
      .then(r => {
        setConfig(r.data.config);
        setDrivers(r.data.drivers || []);
        setPinDrivers(r.data.pinDrivers || []);
        setBackupName(r.data.backupDriverName || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function updateConfig(updates) {
    try {
      const { data } = await client.put('/settings/config', updates);
      setConfig(data.config);
      setToast(t.updated);
      setTimeout(() => setToast(''), 2000);
    } catch {
      setToast(t.error);
      setTimeout(() => setToast(''), 2000);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) {
    return <p className="text-center text-gray-400 py-8">{t.error}</p>;
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Operational Parameters */}
      <Section title={t.settingsOperational}>
        <ConfigRow label={t.defaultDeliveryFee} value={config.defaultDeliveryFee} type="number" hint={t.settingsDeliveryFeeHint} onSave={v => updateConfig({ defaultDeliveryFee: v })} />
        <ConfigRow label={t.settingsTargetMarkup} value={config.targetMarkup} type="number" hint={t.settingsMarkupHint} onSave={v => updateConfig({ targetMarkup: v })} />
        <ConfigRow label={t.settingsDriverCost} value={config.driverCostPerDelivery} type="number" hint={t.settingsDriverCostHint} onSave={v => updateConfig({ driverCostPerDelivery: v })} />
      </Section>

      {/* Drivers */}
      <DriverSettingsSection
        drivers={drivers} pinDrivers={pinDrivers} backupName={backupName}
        setBackupName={setBackupName} config={config} updateConfig={updateConfig}
        setDrivers={setDrivers} setToast={setToast}
      />

      {/* Lists */}
      <Section title={t.settingsLists}>
        <ListEditor label={t.supplier} items={config.suppliers} onSave={v => updateConfig({ suppliers: v })} />
        <ListEditor label={t.category} items={config.stockCategories} onSave={v => updateConfig({ stockCategories: v })} />
        <ListEditor label={t.paymentMethod} items={config.paymentMethods} onSave={v => updateConfig({ paymentMethods: v })} />
        <ListEditor label={t.source} items={config.orderSources} onSave={v => updateConfig({ orderSources: v })} />
        <ListEditor label={t.floristNames} items={config.floristNames || []} hint={t.floristNamesHint} onSave={v => updateConfig({ floristNames: v })} />
        <RateTypesEditor types={config.rateTypes || ['Standard', 'Wedding', 'Holidays']} onSave={v => updateConfig({ rateTypes: v })} />
        <FloristRatesEditor names={config.floristNames || []} rateTypes={config.rateTypes || ['Standard', 'Wedding', 'Holidays']} rates={config.floristRates || {}} onSave={v => updateConfig({ floristRates: v })} />
      </Section>

      {/* Storefront Categories */}
      <StorefrontCategoriesSection config={config} onUpdate={updateConfig} />

      {/* Delivery Zones */}
      <DeliveryZonesSection config={config} onUpdate={updateConfig} />

      {/* Available Today */}
      <Section title={t.settingsAvailableToday}>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <div>
            <span className="text-sm font-medium text-gray-700">{t.settingsAvailCutoff}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.settingsAvailCutoffHint}</p>
          </div>
          <input type="time" value={config.availableTodayCutoff || '18:00'} onChange={e => updateConfig({ availableTodayCutoff: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
        </div>
        <ConfigRow label={t.settingsSlotLeadTime} value={config.slotLeadTimeMinutes || 30} type="number" hint={t.settingsSlotLeadTimeHint} onSave={v => updateConfig({ slotLeadTimeMinutes: v })} />
      </Section>

      {/* Stock tools — low-use admin toggles for the Stock tab */}
      <Section title={t.settingsStock || 'Stock'}>
        <div className="flex items-center justify-between py-3 border-b border-gray-100">
          <div>
            <span className="text-sm font-medium text-gray-700">{t.settingsStockRepairTools || 'Stock repair tools'}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.settingsStockRepairToolsHint || 'Show per-row "Reconcile premade" button to fix items where premade deduction never fired. Off for daily use.'}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={!!config.showStockRepairTools}
              onChange={e => updateConfig({ showStockRepairTools: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-brand-300 rounded-full peer peer-checked:bg-brand-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-full" />
          </label>
        </div>
      </Section>

      {/* Marketing Spend */}
      <MarketingSpendSection sources={config.orderSources} />

      {/* Stock Loss */}
      <StockLossSection />
    </div>
  );
}
