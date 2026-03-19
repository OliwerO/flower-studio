// Re-export shared Toast with florist-specific position (above tab bar)
import { Toast as SharedToast } from '@flower-studio/shared';
export default function Toast() { return <SharedToast position="bottom-24" />; }
