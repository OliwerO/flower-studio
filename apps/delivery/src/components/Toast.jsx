import { useToast } from '../context/ToastContext.jsx';
import { Toast as SharedToast } from '@flower-studio/shared';
export default function Toast() {
  const { toast, dismiss } = useToast();
  return <SharedToast toast={toast} dismiss={dismiss} position="bottom-6" />;
}
