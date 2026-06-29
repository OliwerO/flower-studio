import { AskBlossomPanel } from '@flower-studio/shared';
import t from '../translations.js';

export default function AssistantTab({ isActive }) {
  if (!isActive) return null;
  return (
    <div className="p-4 h-[75vh]">
      <AskBlossomPanel t={t} />
    </div>
  );
}
