import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DEFAULT_EXCLUDED_ROUTES,
  detectDeviceKind,
  hasCampaignSessionFlag,
  isCampaignCurrentlyEligible,
  isDeviceEligible,
  isRouteEligible,
  setCampaignSessionFlag,
  type GlobalPopupPublicCampaign,
} from '../../lib/globalPromotionalPopup';
import { GlobalPromotionalPopupModal } from './GlobalPromotionalPopupModal';

const SESSION_STARTED_AT_KEY = 'novara_gpp_session_started_at';

function readOrInitSessionStartMs(): number {
  const now = Date.now();
  try {
    const raw = window.sessionStorage.getItem(SESSION_STARTED_AT_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= now) {
        return parsed;
      }
    }
    window.sessionStorage.setItem(SESSION_STARTED_AT_KEY, String(now));
  } catch {
    // Fail safely when sessionStorage is restricted
  }
  return now;
}

function isCriticalSystemOrAdminRoute(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  if (lower === '/admin' || lower.startsWith('/admin/')) return true;
  return DEFAULT_EXCLUDED_ROUTES.some(
    (prefix) => prefix !== '/admin' && (lower === prefix || lower.startsWith(`${prefix}/`)),
  );
}

export function GlobalPromotionalPopupHost() {
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const [campaign, setCampaign] = useState<GlobalPopupPublicCampaign | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const impressionTrackedIdsRef = useRef<Set<string>>(new Set());
  const sessionStartMsRef = useRef<number>(
    typeof window !== 'undefined' ? readOrInitSessionStartMs() : Date.now(),
  );

  // Fetch active global promotional campaign once per storefront app session
  useEffect(() => {
    if (fetchedRef.current) return;
    if (isCriticalSystemOrAdminRoute(location.pathname)) return;

    fetchedRef.current = true;
    const controller = new AbortController();
    const device =
      typeof window !== 'undefined' ? detectDeviceKind(window.innerWidth) : 'desktop';

    const params = new URLSearchParams({
      route: location.pathname || '/',
      device,
    });

    fetch(`/api/storefront/global-promotional-popup?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json')) return null;
        return (await res.json()) as {
          ok?: boolean;
          campaign?: GlobalPopupPublicCampaign | null;
          serverNow?: string;
        };
      })
      .then((data) => {
        if (!data || !data.ok || !data.campaign) return;
        setCampaign(data.campaign);
        setServerNow(data.serverNow || null);
      })
      .catch(() => {
        // Silent graceful fallback if DB is offline or network aborted
      });

    return () => {
      controller.abort();
    };
  }, [location.pathname]);

  const sendTrackEvent = useCallback((campaignId: string, event: 'impression' | 'click') => {
    fetch(`/api/storefront/global-promotional-popup/${encodeURIComponent(campaignId)}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ event }),
    }).catch(() => undefined);
  }, []);

  // Schedule single persistent display timer anchored to sessionStartMsRef (never resets on navigation)
  useEffect(() => {
    if (!campaign || modalOpen) return;

    const alreadyShown = hasCampaignSessionFlag(campaign.id, 'shown');
    const alreadyDismissed = hasCampaignSessionFlag(campaign.id, 'dismissed');
    if (alreadyShown || alreadyDismissed) return;

    if (!isRouteEligible(location.pathname, campaign.targeting)) {
      return;
    }

    const delaySeconds = Math.max(0, Number(campaign.displayDelaySeconds ?? 20));
    const targetOpenAtMs = sessionStartMsRef.current + delaySeconds * 1000;
    const remainingMs = Math.max(0, targetOpenAtMs - Date.now());

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;

      // Re-verify session flags, current route, device eligibility, and schedule window right before display
      if (hasCampaignSessionFlag(campaign.id, 'shown') || hasCampaignSessionFlag(campaign.id, 'dismissed')) {
        return;
      }

      const activePath = pathnameRef.current;
      const activeDevice =
        typeof window !== 'undefined' ? detectDeviceKind(window.innerWidth) : 'desktop';

      const routeOk = isRouteEligible(activePath, campaign.targeting);
      const deviceOk = isDeviceEligible(activeDevice, campaign.targeting);
      const stillEligible = isCampaignCurrentlyEligible(
        {
          id: campaign.id,
          status: 'active',
          enabled: true,
          autoDisplay: true,
          priority: campaign.priority,
          startAt: campaign.startAt,
          endAt: campaign.endAt,
          targeting: campaign.targeting,
        },
        {
          now: new Date(),
          pathname: activePath,
          deviceKind: activeDevice,
          requireAutoDisplay: true,
        },
      );

      if (!routeOk || !deviceOk || !stillEligible) {
        return;
      }

      setCampaignSessionFlag(campaign.id, 'shown');
      setModalOpen(true);

      if (!impressionTrackedIdsRef.current.has(campaign.id)) {
        impressionTrackedIdsRef.current.add(campaign.id);
        sendTrackEvent(campaign.id, 'impression');
      }
    }, remainingMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [campaign, modalOpen, location.pathname, sendTrackEvent]);

  // If user navigates onto /admin or an excluded route while modal is open, close it cleanly
  useEffect(() => {
    if (!modalOpen || !campaign) return;
    if (!isRouteEligible(location.pathname, campaign.targeting)) {
      setModalOpen(false);
    }
  }, [location.pathname, modalOpen, campaign]);

  const handleClose = useCallback(() => {
    if (campaign) {
      setCampaignSessionFlag(campaign.id, 'dismissed');
      setCampaignSessionFlag(campaign.id, 'shown');
    }
    setModalOpen(false);
  }, [campaign]);

  const handleTrackClick = useCallback(
    (campaignId: string) => {
      setCampaignSessionFlag(campaignId, 'dismissed');
      setCampaignSessionFlag(campaignId, 'shown');
      sendTrackEvent(campaignId, 'click');
    },
    [sendTrackEvent],
  );

  if (!campaign || !modalOpen) return null;

  return (
    <GlobalPromotionalPopupModal
      campaign={campaign}
      open={modalOpen}
      onClose={handleClose}
      mode="live"
      serverNow={serverNow}
      onTrackClick={handleTrackClick}
    />
  );
}
