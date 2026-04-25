import {
  loadActiveView,
  loadAuctionDecisions,
  loadSettings,
  loadTrackedAuctions,
  saveActiveView,
  saveAuctionDecisions,
  saveSettings,
  saveTrackedAuctions,
} from './storage'

describe('storage helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when storage is empty', () => {
    expect(loadTrackedAuctions()).toEqual([])
    expect(loadAuctionDecisions()).toEqual({})
    expect(loadActiveView()).toBe('import')
    expect(loadSettings()).toEqual({ proxyPrefix: 'https://corsproxy.io/?url=' })
  })

  it('persists and loads tracked auctions and decisions', () => {
    const auctions = [
      {
        id: 'a1',
        auctionId: '123',
        auctionUrl: 'https://www.k-bid.com/auction/123',
        addedAt: '2026-04-24T00:00:00.000Z',
      },
    ]

    const decisions = {
      '123': {
        '1': 'saved' as const,
        '2': 'ignored' as const,
      },
    }

    saveTrackedAuctions(auctions)
    saveAuctionDecisions(decisions)

    expect(loadTrackedAuctions()).toEqual(auctions)
    expect(loadAuctionDecisions()).toEqual(decisions)
  })

  it('guards against malformed JSON payloads', () => {
    localStorage.setItem('kbid-browser.tracked-auctions.v1', '{nope')
    localStorage.setItem('kbid-browser.auction-decisions.v1', '[]')
    localStorage.setItem('kbid-browser.settings.v1', '{broken')

    expect(loadTrackedAuctions()).toEqual([])
    expect(loadAuctionDecisions()).toEqual({})
    expect(loadSettings()).toEqual({ proxyPrefix: 'https://corsproxy.io/?url=' })
  })

  it('persists and restores settings and active view', () => {
    saveSettings({ proxyPrefix: 'https://api.allorigins.win/raw?url=' })
    saveActiveView('swipe')

    expect(loadSettings()).toEqual({ proxyPrefix: 'https://api.allorigins.win/raw?url=' })
    expect(loadActiveView()).toBe('swipe')
  })
})
