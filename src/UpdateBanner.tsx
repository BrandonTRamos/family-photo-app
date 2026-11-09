import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { watchForUpdates } from './update-checks';

/** A new deploy waits in the background until the user chooses to refresh. */
export function UpdateBanner() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registered) {
      setRegistration(registered);
    },
  });

  useEffect(() => {
    if (registration) return watchForUpdates(registration);
  }, [registration]);

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version is available.</span>
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        Refresh
      </button>
    </div>
  );
}
