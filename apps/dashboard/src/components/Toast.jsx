// Re-export shared Toast with dashboard-specific position
import { Toast as SharedToast } from '@flower-studio/shared';
export default function Toast() { return <SharedToast position="bottom-8" />; }
