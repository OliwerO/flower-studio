// Re-export shared Toast with delivery-specific position (near bottom)
import { Toast as SharedToast } from '@flower-studio/shared';
export default function Toast() { return <SharedToast position="bottom-6" />; }
