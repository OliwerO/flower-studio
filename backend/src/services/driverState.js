// Shared driver state — extracted to avoid circular dependency between auth.js and settings.js.
// Like a shared whiteboard between the security desk (auth) and the shift manager (settings).

const state = {
  backupDriverName: null,
  _lastSetDate:     null,
};

function autoClearIfNewDay() {
  const today = new Date().toISOString().split('T')[0];
  if (state._lastSetDate && state._lastSetDate !== today) {
    state.backupDriverName = null;
    state._lastSetDate = null;
  }
}

export function getBackupDriverName() {
  autoClearIfNewDay();
  return state.backupDriverName;
}

export function setBackupDriverName(name) {
  state.backupDriverName = name || null;
  if (name) state._lastSetDate = new Date().toISOString().split('T')[0];
}
