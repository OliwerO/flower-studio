import t from '../../translations.js';
import client from '../../api/client.js';
import { ListEditor, Section } from './SettingsPrimitives.jsx';

export default function DriverSettingsSection({ drivers, pinDrivers, backupName, setBackupName, config, updateConfig, setDrivers, setToast }) {
  async function saveBackupName() {
    await client.put('/settings/backup-driver', { name: backupName || null });
    setToast(t.updated);
    setTimeout(() => setToast(''), 2000);
    const { data } = await client.get('/settings');
    setDrivers(data.drivers || []);
  }

  return (
    <Section title={t.settingsDrivers}>
      <p className="text-xs text-gray-400 mb-2">{t.settingsDriversHint}</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {drivers.map(name => (
          <span key={name} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
            {name}
          </span>
        ))}
      </div>

      {pinDrivers.includes('Backup') && (
        <div className="flex items-center gap-2 py-3 border-t border-gray-100">
          <div className="flex-1">
            <span className="text-sm font-medium text-gray-700">{t.backupDriverToday}</span>
            <p className="text-xs text-gray-400 mt-0.5">{t.backupDriverHint}</p>
          </div>
          <input
            value={backupName}
            onChange={e => setBackupName(e.target.value)}
            placeholder="Backup"
            className="w-32 text-sm px-2 py-1.5 border rounded-lg"
            onKeyDown={e => { if (e.key === 'Enter') saveBackupName(); }}
          />
          <button
            onClick={saveBackupName}
            className="text-xs text-white bg-brand-600 px-2 py-1.5 rounded-lg"
          >OK</button>
        </div>
      )}

      <ListEditor
        label={t.settingsExtraDrivers}
        items={config.extraDrivers || []}
        hint={t.settingsExtraDriversHint}
        onSave={v => updateConfig({ extraDrivers: v })}
      />
    </Section>
  );
}
