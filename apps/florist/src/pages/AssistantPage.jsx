import { AskBlossomPanel } from '@flower-studio/shared';
import t from '../translations.js';

// Owner-only assistant page (the owner uses the florist app on her phone). Route
// gating lives in App.jsx (OwnerRoute); this page just hosts the shared panel.
export default function AssistantPage() {
  return (
    <div className="min-h-screen pb-24 px-3 pt-4 dark:bg-dark-bg">
      <div className="max-w-2xl mx-auto h-[calc(100vh-8rem)]">
        <AskBlossomPanel t={t} />
      </div>
    </div>
  );
}
