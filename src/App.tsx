import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { normalizeAuctionInput, refreshAuctionData } from './lib/kbid'
import {
  loadAuctionDecisions,
  loadSettings,
  saveAuctionDecisions,
  loadTrackedAuctions,
  saveSettings,
  saveTrackedAuctions,
} from './lib/storage'
import type { SwipeDecision, TrackedAuction } from './types'

type AppView = 'import' | 'swipe' | 'saved'

const SWIPE_THRESHOLD = 60

function App() {
  const [trackedAuctions, setTrackedAuctions] = useState<TrackedAuction[]>(() => loadTrackedAuctions())
  const [auctionDecisions, setAuctionDecisions] = useState(() => loadAuctionDecisions())
  const [settings, setSettings] = useState(() => loadSettings())
  const [auctionInput, setAuctionInput] = useState('')
  const [selectedAuctionId, setSelectedAuctionId] = useState<string | null>(
    () => loadTrackedAuctions()[0]?.id ?? null,
  )
  const [activeView, setActiveView] = useState<AppView>('import')
  const [inputError, setInputError] = useState('')
  const [loadingAuctionId, setLoadingAuctionId] = useState<string | null>(null)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [swipeCue, setSwipeCue] = useState<'left' | 'right' | null>(null)
  const [loadedSwipeImageLotId, setLoadedSwipeImageLotId] = useState<string | null>(null)

  const selectedAuction = useMemo(() => {
    if (!selectedAuctionId) {
      return null
    }

    return trackedAuctions.find((entry) => entry.id === selectedAuctionId) ?? null
  }, [selectedAuctionId, trackedAuctions])

  const selectedAuctionDecisions = useMemo(() => {
    if (!selectedAuction) {
      return {}
    }

    return auctionDecisions[selectedAuction.auctionId] ?? {}
  }, [auctionDecisions, selectedAuction])

  const allLots = useMemo(() => selectedAuction?.data?.lots ?? [], [selectedAuction])

  const undecidedLots = useMemo(
    () => allLots.filter((lot) => !selectedAuctionDecisions[lot.id]),
    [allLots, selectedAuctionDecisions],
  )

  const savedLots = useMemo(
    () => allLots.filter((lot) => selectedAuctionDecisions[lot.id] === 'saved'),
    [allLots, selectedAuctionDecisions],
  )

  const ignoredCount = useMemo(
    () => allLots.filter((lot) => selectedAuctionDecisions[lot.id] === 'ignored').length,
    [allLots, selectedAuctionDecisions],
  )

  const currentLot = undecidedLots[0]

  const reviewedCount = allLots.length - undecidedLots.length
  const progressPct = allLots.length ? Math.round((reviewedCount / allLots.length) * 100) : 0

  const triggerDecision = useCallback((decision: SwipeDecision, cue: 'left' | 'right') => {
    if (!selectedAuction || !currentLot) {
      return
    }

    setSwipeCue(cue)
    window.setTimeout(() => {
      setSwipeCue(null)
      setAuctionDecisions((prev) => {
        const auctionDecisionMap = prev[selectedAuction.auctionId] ?? {}
        const next = {
          ...prev,
          [selectedAuction.auctionId]: {
            ...auctionDecisionMap,
            [currentLot.id]: decision,
          },
        }
        saveAuctionDecisions(next)
        return next
      })
    }, 120)
  }, [currentLot, selectedAuction])

  useEffect(() => {
    if (activeView !== 'swipe' || !currentLot || !selectedAuction) {
      return
    }

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
      if (isTyping) {
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        triggerDecision('ignored', 'left')
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        triggerDecision('saved', 'right')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView, currentLot, selectedAuction, triggerDecision])

  useEffect(() => {
    if (!currentLot) {
      setLoadedSwipeImageLotId(null)
      return
    }

    if (!currentLot.imageUrl) {
      setLoadedSwipeImageLotId(currentLot.id)
      return
    }

    setLoadedSwipeImageLotId(null)
  }, [currentLot])
  const isSwipeImageLoading = Boolean(currentLot?.imageUrl) && loadedSwipeImageLotId !== currentLot?.id

  const addAuction = () => {
    const normalized = normalizeAuctionInput(auctionInput)
    if (!normalized) {
      setInputError('Enter a valid K-BID auction URL or numeric auction ID.')
      return
    }

    const exists = trackedAuctions.find((entry) => entry.auctionId === normalized.auctionId)
    if (exists) {
      setSelectedAuctionId(exists.id)
      setAuctionInput('')
      setInputError('')
      return
    }

    const nextAuction: TrackedAuction = {
      id: crypto.randomUUID(),
      auctionId: normalized.auctionId,
      auctionUrl: normalized.auctionUrl,
      addedAt: new Date().toISOString(),
    }

    const nextAuctions = [nextAuction, ...trackedAuctions]
    setTrackedAuctions(nextAuctions)
    saveTrackedAuctions(nextAuctions)
    setSelectedAuctionId(nextAuction.id)
    setActiveView('import')
    setAuctionInput('')
    setInputError('')
  }

  const removeAuction = (id: string) => {
    const nextAuctions = trackedAuctions.filter((entry) => entry.id !== id)
    setTrackedAuctions(nextAuctions)
    saveTrackedAuctions(nextAuctions)

    const removed = trackedAuctions.find((entry) => entry.id === id)
    if (removed) {
      setAuctionDecisions((prev) => {
        const next = { ...prev }
        delete next[removed.auctionId]
        saveAuctionDecisions(next)
        return next
      })
    }

    if (selectedAuctionId === id) {
      setSelectedAuctionId(nextAuctions[0]?.id ?? null)
    }
  }

  const refreshAuction = async (id: string) => {
    const auction = trackedAuctions.find((entry) => entry.id === id)
    if (!auction) {
      return
    }

    setLoadingAuctionId(id)
    try {
      const data = await refreshAuctionData(auction.auctionId, auction.auctionUrl, settings.proxyPrefix)
      const nextAuctions = trackedAuctions.map((entry) => {
        if (entry.id !== id) {
          return entry
        }

        return {
          ...entry,
          data,
          lastRefreshAt: new Date().toISOString(),
          lastError: undefined,
        }
      })

      setTrackedAuctions(nextAuctions)
      saveTrackedAuctions(nextAuctions)
      if (selectedAuctionId === id) {
        setActiveView('swipe')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed'
      const hint =
        ' Try setting a proxy prefix to work around CORS. Use the AllOrigins or corsproxy.io preset in Settings, or clear the proxy and try again if one is already set.'

      const nextAuctions = trackedAuctions.map((entry) => {
        if (entry.id !== id) {
          return entry
        }

        return {
          ...entry,
          lastError: `${message}.${hint}`,
        }
      })

      setTrackedAuctions(nextAuctions)
      saveTrackedAuctions(nextAuctions)
    } finally {
      setLoadingAuctionId(null)
    }
  }

  const onSettingsChange = (proxyPrefix: string) => {
    const nextSettings = {
      ...settings,
      proxyPrefix,
    }

    setSettings(nextSettings)
    saveSettings(nextSettings)
  }

  const resetAuctionReview = () => {
    if (!selectedAuction) {
      return
    }

    setAuctionDecisions((prev) => {
      const next = {
        ...prev,
        [selectedAuction.auctionId]: {},
      }
      saveAuctionDecisions(next)
      return next
    })
    setActiveView('swipe')
  }

  const onTouchStart = (x: number) => {
    setTouchStartX(x)
  }

  const onTouchEnd = (x: number) => {
    if (touchStartX === null) {
      return
    }

    const delta = x - touchStartX
    setTouchStartX(null)

    if (Math.abs(delta) < SWIPE_THRESHOLD) {
      return
    }

    if (delta > 0) {
      triggerDecision('saved', 'right')
    } else {
      triggerDecision('ignored', 'left')
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="hero-copy">
          <h1>SwipeBid</h1>
          <p>Import an auction, swipe right to save, swipe left to ignore, then open favorites to bid.</p>
        </div>
      </header>

      <nav className="flow-tabs">
        <button type="button" className={activeView === 'import' ? 'active' : ''} onClick={() => setActiveView('import')}>
          1. Import
        </button>
        <button
          type="button"
          className={activeView === 'swipe' ? 'active' : ''}
          onClick={() => setActiveView('swipe')}
          disabled={!selectedAuction?.data}
        >
          2. Swipe
        </button>
        <button
          type="button"
          className={activeView === 'saved' ? 'active' : ''}
          onClick={() => setActiveView('saved')}
          disabled={!savedLots.length}
        >
          3. Favorites
        </button>
      </nav>

      <main className="app-main">
        {activeView === 'import' ? (
          <section className="panel">
            <h2>Import Auction</h2>
            <div className="add-auction-row">
              <input
                type="text"
                placeholder="Paste K-BID auction URL or ID"
                value={auctionInput}
                onChange={(event) => setAuctionInput(event.target.value)}
              />
              <button type="button" onClick={addAuction}>
                Add Auction
              </button>
            </div>
            {inputError ? <p className="error-text">{inputError}</p> : null}

            <ul className="auction-list">
              {trackedAuctions.map((auction) => (
                <li key={auction.id} className={auction.id === selectedAuctionId ? 'selected' : ''}>
                  <div>
                    <strong>{auction.data?.title || `Auction ${auction.auctionId}`}</strong>
                    <p>{auction.auctionUrl}</p>
                    <small>
                      {auction.data
                        ? `${auction.data.lots.length} parsed, ${
                            auctionDecisions[auction.auctionId]
                              ? Object.keys(auctionDecisions[auction.auctionId]).length
                              : 0
                          } reviewed`
                        : 'No data yet'}
                    </small>
                  </div>
                  <div className="inline-actions">
                    <button type="button" onClick={() => setSelectedAuctionId(auction.id)}>
                      Select
                    </button>
                    <button
                      type="button"
                      onClick={() => void refreshAuction(auction.id)}
                      disabled={loadingAuctionId === auction.id}
                    >
                      {loadingAuctionId === auction.id ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button type="button" className="danger" onClick={() => removeAuction(auction.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {selectedAuction?.lastError ? <p className="error-text">{selectedAuction.lastError}</p> : null}
            {selectedAuction?.data?.warnings.length ? (
              <div className="warning-box">
                <strong>Parser warnings</strong>
                <ul>
                  {selectedAuction.data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeView === 'swipe' ? (
          <section className="panel swipe-stage">
            {selectedAuction?.data ? (
              <>
                <div className="swipe-header">
                  <div>
                    <h2 className="swipe-auction-title">{selectedAuction.data.title}</h2>
                    <p>
                      Reviewed {reviewedCount}/{allLots.length} ({progressPct}%)
                    </p>
                  </div>
                  <div className="swipe-stats">
                    <span>Saved: {savedLots.length}</span>
                    <span>Ignored: {ignoredCount}</span>
                  </div>
                </div>

                <div className="progress-track" aria-hidden="true">
                  <div className="progress-fill" style={{ width: `${progressPct}%` }}></div>
                </div>

                {currentLot ? (
                  <article
                    className={`swipe-card ${swipeCue ? `swipe-${swipeCue}` : ''}`}
                    onTouchStart={(event) => onTouchStart(event.changedTouches[0].clientX)}
                    onTouchEnd={(event) => onTouchEnd(event.changedTouches[0].clientX)}
                  >
                    <div className="swipe-image-wrap">
                      {currentLot.imageUrl ? (
                        <>
                          <img
                            key={currentLot.id}
                            src={currentLot.imageUrl}
                            alt={currentLot.title}
                            className={`swipe-image ${isSwipeImageLoading ? 'is-loading' : ''}`}
                            loading="eager"
                            onLoad={() => setLoadedSwipeImageLotId(currentLot.id)}
                            onError={() => setLoadedSwipeImageLotId(currentLot.id)}
                          />
                          {isSwipeImageLoading ? (
                            <div className="image-loading-overlay" role="status" aria-live="polite">
                              <div className="image-spinner" aria-hidden="true"></div>
                              <span>Loading photo...</span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="image-placeholder">No image available</div>
                      )}
                    </div>
                    <div className="swipe-content">
                      <div className="lot-chip">Lot {currentLot.lotNumber}</div>
                      <h3>{currentLot.title}</h3>
                      <p className="pricing">{formatBidSummary(currentLot.currentBid, currentLot.nextBid)}</p>
                      <p className="meta">{formatLotMeta(currentLot.timeRemaining, currentLot.beginsClosing)}</p>
                      <a href={currentLot.itemUrl} target="_blank" rel="noreferrer">
                        Open original listing
                      </a>
                    </div>
                  </article>
                ) : (
                  <div className="empty-state compact">
                    <h3>Deck complete</h3>
                    <p>You reviewed every parsed lot. Open Favorites to decide what to bid on.</p>
                  </div>
                )}

                <div className="decision-row">
                  <button type="button" className="decision ignore" onClick={() => triggerDecision('ignored', 'left')} disabled={!currentLot}>
                    Ignore (←)
                  </button>
                  <button type="button" className="decision save" onClick={() => triggerDecision('saved', 'right')} disabled={!currentLot}>
                    Save (→)
                  </button>
                </div>

                <div className="inline-actions">
                  <button type="button" onClick={resetAuctionReview}>
                    Reset Decisions
                  </button>
                  <button type="button" onClick={() => setActiveView('saved')} disabled={!savedLots.length}>
                    Go To Favorites
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h2>No parsed auction yet</h2>
                <p>Go to Import, select an auction, and run Refresh.</p>
              </div>
            )}
          </section>
        ) : null}

        {activeView === 'saved' ? (
          <section className="panel">
            <div className="saved-header">
              <h2>Favorites</h2>
              <p>
                {savedLots.length} saved out of {allLots.length} lots in this auction
              </p>
            </div>
            {savedLots.length ? (
              <div className="saved-grid">
                {savedLots.map((lot) => (
                  <article key={lot.id} className="saved-card">
                    {lot.imageUrl ? (
                      <img src={lot.imageUrl} alt={lot.title} className="saved-image" />
                    ) : (
                      <div className="image-placeholder small">No image</div>
                    )}
                    <div>
                      <div className="lot-chip">Lot {lot.lotNumber}</div>
                      <h3>{lot.title}</h3>
                      <p className="pricing">{formatBidSummary(lot.currentBid, lot.nextBid)}</p>
                      <p className="meta">{formatLotMeta(lot.timeRemaining, lot.beginsClosing)}</p>
                    </div>
                    <div className="inline-actions">
                      <a className="link-button" href={lot.itemUrl} target="_blank" rel="noreferrer">
                        Open To Bid
                      </a>
                      <button type="button" className="danger" onClick={() => triggerFavoriteUndo(selectedAuction?.auctionId, lot.id, setAuctionDecisions)}>
                        Remove Favorite
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                <h3>No favorites yet</h3>
                <p>Go to Swipe and save items you want to bid on.</p>
              </div>
            )}
          </section>
        ) : null}
      </main>

      {activeView === 'import' ? (
        <section className="panel settings-drawer">
          <details>
            <summary>Proxy Settings</summary>
            <div className="settings-panel">
              <label htmlFor="proxy-prefix">Proxy Prefix (optional)</label>
              <input
                id="proxy-prefix"
                type="text"
                placeholder="https://corsproxy.io/?url="
                value={settings.proxyPrefix}
                onChange={(event) => onSettingsChange(event.target.value)}
              />
              <small>
                For prefixes that require substitution, use {'{url}'} placeholder.
                Example: https://your-worker.example/fetch?url={'{url}'}
              </small>
              <div className="inline-actions">
                <button
                  type="button"
                  onClick={() => onSettingsChange('https://corsproxy.io/?url=')}
                >
                  corsproxy.io
                </button>
                <button
                  type="button"
                  onClick={() => onSettingsChange('https://api.allorigins.win/raw?url=')}
                >
                  AllOrigins
                </button>
                <button type="button" onClick={() => onSettingsChange('')}>
                  Clear
                </button>
              </div>
            </div>
          </details>
        </section>
      ) : null}
    </div>
  )
}

function formatMoney(value: number | undefined): string {
  if (value === undefined) {
    return 'n/a'
  }

  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  })
}

function formatBidSummary(currentBid: number | undefined, nextBid: number | undefined): string {
  return `Current: ${formatMoney(currentBid)} | Next: ${formatMoney(nextBid)}`
}

function formatLotMeta(timeRemaining: string | undefined, beginsClosing: string | undefined): string {
  if (timeRemaining) {
    return `Time remaining: ${timeRemaining}`
  }

  if (beginsClosing) {
    return `Begins closing: ${beginsClosing}`
  }

  return 'Timing not available'
}

function triggerFavoriteUndo(
  auctionId: string | undefined,
  lotId: string,
  setAuctionDecisions: Dispatch<SetStateAction<Record<string, Record<string, SwipeDecision>>>>,
): void {
  if (!auctionId) {
    return
  }

  setAuctionDecisions((prev) => {
    const auctionMap = prev[auctionId] ?? {}
    const nextAuctionMap = { ...auctionMap }
    delete nextAuctionMap[lotId]

    const next = {
      ...prev,
      [auctionId]: nextAuctionMap,
    }

    saveAuctionDecisions(next)
    return next
  })
}

export default App
