import { useMoocha } from '../store.jsx';

export default function Toast() {
  const { toast } = useMoocha();
  return <div className={`toast ${toast ? 'show' : ''}`}>{toast || ''}</div>;
}
