import type { AppSettings, AuctionDecisionStore, TrackedAuction } from '../types'

const TRACKED_AUCTIONS_KEY = 'kbid-browser.tracked-auctions.v1'
const APP_SETTINGS_KEY = 'kbid-browser.settings.v1'
const AUCTION_DECISIONS_KEY = 'kbid-browser.auction-decisions.v1'
const ACTIVE_VIEW_KEY = 'kbid-browser.active-view.v1'

const defaultSettings: AppSettings = {
  proxyPrefix: 'https://corsproxy.io/?url=',
}

export function loadTrackedAuctions(): TrackedAuction[] {
  try {
    const raw = localStorage.getItem(TRACKED_AUCTIONS_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as TrackedAuction[]
  } catch {
    return []
  }
}

export function saveTrackedAuctions(trackedAuctions: TrackedAuction[]): void {
  localStorage.setItem(TRACKED_AUCTIONS_KEY, JSON.stringify(trackedAuctions))
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY)
    if (!raw) {
      return defaultSettings
    }

    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...defaultSettings,
      ...parsed,
    }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
}

export function loadAuctionDecisions(): AuctionDecisionStore {
  try {
    const raw = localStorage.getItem(AUCTION_DECISIONS_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return parsed as AuctionDecisionStore
  } catch {
    return {}
  }
}

export function saveAuctionDecisions(store: AuctionDecisionStore): void {
  localStorage.setItem(AUCTION_DECISIONS_KEY, JSON.stringify(store))
}

export function loadActiveView(): 'import' | 'swipe' | 'saved' {
  const raw = localStorage.getItem(ACTIVE_VIEW_KEY)
  if (raw === 'import' || raw === 'swipe' || raw === 'saved') {
    return raw
  }

  return 'import'
}

export function saveActiveView(view: 'import' | 'swipe' | 'saved'): void {
  localStorage.setItem(ACTIVE_VIEW_KEY, view)
}
