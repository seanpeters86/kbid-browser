import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { browseAuctionList, normalizeAuctionInput, refreshAuctionData } from './lib/kbid'
import {
  loadActiveView,
  loadAuctionDecisions,
  loadSettings,
  saveAuctionDecisions,
  saveActiveView,
  loadTrackedAuctions,
  saveSettings,
  saveTrackedAuctions,
} from './lib/storage'
import type { AuctionBrowseFilters, AuctionBrowseItem, SwipeDecision, TrackedAuction } from './types'

type AppView = 'import' | 'swipe' | 'saved'

const SWIPE_THRESHOLD = 60
const DEFAULT_BROWSE_FILTERS: AuctionBrowseFilters = {
  distanceRadius: '10',
  distanceZip: '55014',
}

function App() {
  const [trackedAuctions, setTrackedAuctions] = useState<TrackedAuction[]>(() => loadTrackedAuctions())
  const [auctionDecisions, setAuctionDecisions] = useState(() => loadAuctionDecisions())
  const [settings, setSettings] = useState(() => loadSettings())
  const [auctionInput, setAuctionInput] = useState('')
  const [selectedAuctionId, setSelectedAuctionId] = useState<string | null>(
    () => loadTrackedAuctions()[0]?.id ?? null,
  )
  const [activeView, setActiveView] = useState<AppView>(() => loadActiveView())
  const [inputError, setInputError] = useState('')
  const [loadingAuctionId, setLoadingAuctionId] = useState<string | null>(null)
  const [browseFilters, setBrowseFilters] = useState<AuctionBrowseFilters>(DEFAULT_BROWSE_FILTERS)
  const [browseAuctions, setBrowseAuctions] = useState<AuctionBrowseItem[]>([])
  const [browseSourceUrl, setBrowseSourceUrl] = useState('')
  const [browseError, setBrowseError] = useState('')
  const [isBrowsing, setIsBrowsing] = useState(false)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [swipeCue, setSwipeCue] = useState<'left' | 'right' | null>(null)
  const [loadedSwipeImageLotId, setLoadedSwipeImageLotId] = useState<string | null>(null)
  const [focusedLotId, setFocusedLotId] = useState<string | null>(null)

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

  const currentLot = useMemo(() => {
    if (focusedLotId) {
      const focused = allLots.find((lot) => lot.id === focusedLotId)
      if (focused) {
        return focused
      }
    }

    if (undecidedLots[0]) {
      return undecidedLots[0]
    }

    return null
  }, [allLots, focusedLotId, undecidedLots])

  const currentLotIndex = useMemo(() => {
    if (!currentLot) {
      return -1
    }

    return allLots.findIndex((lot) => lot.id === currentLot.id)
  }, [allLots, currentLot])

  const canGoBack = currentLotIndex > 0
  const canGoForward = currentLotIndex >= 0 && currentLotIndex < allLots.length - 1
  const currentLotDecision = currentLot && selectedAuction ? selectedAuctionDecisions[currentLot.id] : undefined

  const reviewedCount = allLots.length - undecidedLots.length
  const progressPct = allLots.length ? Math.round((reviewedCount / allLots.length) * 100) : 0

  const triggerDecision = useCallback((decision: SwipeDecision, cue: 'left' | 'right') => {
    if (!selectedAuction || !currentLot) {
      return
    }

    const currentIndex = allLots.findIndex((lot) => lot.id === currentLot.id)
    const nextLotId = currentIndex >= 0 ? allLots[currentIndex + 1]?.id ?? null : null

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
      setFocusedLotId(nextLotId)
    }, 120)
  }, [allLots, currentLot, selectedAuction])

  const moveLotFocus = useCallback((delta: number) => {
    if (!currentLot) {
      return
    }

    const index = allLots.findIndex((lot) => lot.id === currentLot.id)
    if (index < 0) {
      return
    }

    const target = allLots[index + delta]
    if (!target) {
      return
    }

    setFocusedLotId(target.id)
  }, [allLots, currentLot])

  useEffect(() => {
    saveActiveView(activeView)
  }, [activeView])

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

  const isSwipeImageLoading = Boolean(currentLot?.imageUrl) && loadedSwipeImageLotId !== currentLot?.id

  const selectAuction = (id: string | null) => {
    setSelectedAuctionId(id)
    setFocusedLotId(null)
  }

  const addAuctionByInput = (input: string, label?: string) => {
    const normalized = normalizeAuctionInput(input)
    if (!normalized) {
      setInputError('Enter a valid K-BID auction URL or numeric auction ID.')
      return false
    }

    const exists = trackedAuctions.find((entry) => entry.auctionId === normalized.auctionId)
    if (exists) {
      selectAuction(exists.id)
      setAuctionInput('')
      setInputError('')
      return true
    }

    const nextAuction: TrackedAuction = {
      id: crypto.randomUUID(),
      auctionId: normalized.auctionId,
      auctionUrl: normalized.auctionUrl,
      label,
      addedAt: new Date().toISOString(),
    }

    const nextAuctions = [nextAuction, ...trackedAuctions]
    setTrackedAuctions(nextAuctions)
    saveTrackedAuctions(nextAuctions)
    selectAuction(nextAuction.id)
    setActiveView('import')
    setAuctionInput('')
    setInputError('')
    return true
  }

  const addAuction = () => {
    addAuctionByInput(auctionInput)
  }

  const browseAuctionsByFilters = async () => {
    setIsBrowsing(true)
    setBrowseError('')
    try {
      const response = await browseAuctionList(browseFilters, settings.proxyPrefix)
      setBrowseAuctions(response.auctions)
      setBrowseSourceUrl(response.url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Browse failed'
      const hint =
        ' Try setting a proxy prefix to work around CORS. Use the AllOrigins or corsproxy.io preset in Settings, or clear the proxy and try again if one is already set.'
      setBrowseError(`${message}.${hint}`)
    } finally {
      setIsBrowsing(false)
    }
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
      selectAuction(nextAuctions[0]?.id ?? null)
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

  const resetAuctionReview = (auctionId: string) => {
    if (!auctionId) {
      return
    }

    const confirmed = window.confirm(
      'Reset all decisions for this auction? This will clear both saved and ignored lots.',
    )

    if (!confirmed) {
      return
    }

    setAuctionDecisions((prev) => {
      const next = {
        ...prev,
        [auctionId]: {},
      }
      saveAuctionDecisions(next)
      return next
    })
    setFocusedLotId(null)
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
        </div>
        <details className="hero-help">
          <summary aria-label="How it works">?</summary>
          <div className="hero-help-popover">
            Import an auction URL or ID, refresh to parse lots, then swipe and review favorites.
          </div>
        </details>
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

            <div className="browse-panel">
              <div className="browse-header">
                <h3>Browse Existing Auctions</h3>
                <p>Search K-BID auction list defaults with configurable radius and zip code.</p>
              </div>
              <div className="browse-controls">
                <div className="browse-field">
                  <label htmlFor="distance-radius">Distance Radius</label>
                  <select
                    id="distance-radius"
                    value={browseFilters.distanceRadius}
                    onChange={(event) => {
                      const value = event.target.value as AuctionBrowseFilters['distanceRadius']
                      setBrowseFilters((prev) => ({ ...prev, distanceRadius: value }))
                    }}
                  >
                    <option value="10">10 miles</option>
                    <option value="25">25 miles</option>
                    <option value="50">50 miles</option>
                  </select>
                </div>

                <div className="browse-field">
                  <label htmlFor="distance-zip">Distance ZIP</label>
                  <input
                    id="distance-zip"
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    value={browseFilters.distanceZip}
                    onChange={(event) => {
                      setBrowseFilters((prev) => ({ ...prev, distanceZip: event.target.value }))
                    }}
                  />
                </div>

                <button type="button" onClick={() => void browseAuctionsByFilters()} disabled={isBrowsing}>
                  {isBrowsing ? 'Searching...' : 'Search Auctions'}
                </button>
              </div>

              {browseSourceUrl ? (
                <p className="browse-source">
                  Source query:{' '}
                  <a href={browseSourceUrl} target="_blank" rel="noreferrer">
                    Open K-BID list page
                  </a>
                </p>
              ) : null}
              {browseError ? <p className="error-text">{browseError}</p> : null}

              {browseAuctions.length ? (
                <ul className="browse-results">
                  {browseAuctions.map((auction) => {
                    const existing = trackedAuctions.find((entry) => entry.auctionId === auction.auctionId)

                    return (
                      <li key={auction.auctionId} className="browse-card">
                        <div>
                          <strong title={auction.title}>{auction.abbreviatedTitle}</strong>
                          <p>{auction.location ?? 'Location unavailable'}</p>
                          <small>
                            {auction.distanceAway ? `Distance: ${auction.distanceAway}` : 'Distance unavailable'}
                            {' | '}
                            {auction.closingDate ? `Closes: ${auction.closingDate}` : 'Closing date unavailable'}
                          </small>
                        </div>
                        {auction.imageUrls.length ? (
                          <div className="browse-images">
                            {auction.imageUrls.map((imageUrl, index) => (
                              <img
                                key={`${auction.auctionId}-${imageUrl}`}
                                src={imageUrl}
                                alt={`${auction.abbreviatedTitle} preview ${index + 1}`}
                                loading="lazy"
                              />
                            ))}
                          </div>
                        ) : null}
                        <div className="inline-actions">
                          <a className="link-button" href={auction.auctionUrl} target="_blank" rel="noreferrer">
                            Open Auction
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              addAuctionByInput(auction.auctionUrl, auction.abbreviatedTitle)
                            }}
                          >
                            {existing ? 'Select Tracked' : 'Import Auction'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {!browseAuctions.length && !isBrowsing && !browseError ? (
                <p className="meta">Run Search Auctions to load auction cards with location, distance, close time, and sample images.</p>
              ) : null}
            </div>

            <ul className="auction-list">
              {trackedAuctions.map((auction) => (
                <li key={auction.id} className={auction.id === selectedAuctionId ? 'selected' : ''}>
                  <div>
                    <strong>{auction.data?.title || auction.label || `Auction ${auction.auctionId}`}</strong>
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
                    <button type="button" onClick={() => selectAuction(auction.id)}>
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
                    {auction.id === selectedAuctionId ? (
                      <button type="button" onClick={() => resetAuctionReview(auction.auctionId)}>
                        Reset Decisions
                      </button>
                    ) : null}
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
                    <span className="stat-pill saved" aria-label={`Saved lots: ${savedLots.length}`} title="Saved lots">
                      ✓ {savedLots.length}
                    </span>
                    <span className="stat-pill ignored" aria-label={`Ignored lots: ${ignoredCount}`} title="Ignored lots">
                      ✕ {ignoredCount}
                    </span>
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
                      <a href={currentLot.itemUrl} target="_blank" rel="noreferrer" className="swipe-image-link">
                        <div className="lot-chip lot-chip-overlay">Lot {currentLot.lotNumber}</div>
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
                      </a>
                    </div>
                    <div className="swipe-content">
                      <h3>{currentLot.title}</h3>
                      <p className="pricing">{formatBidSummary(currentLot.currentBid, currentLot.nextBid)}</p>
                      <p className="meta">{formatLotMeta(currentLot.timeRemaining, currentLot.beginsClosing)}</p>
                      <p className={`lot-state ${currentLotDecision ?? 'unreviewed'}`}>
                        Status: {formatDecisionLabel(currentLotDecision)}
                      </p>
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

                <div className="history-row">
                  <button type="button" onClick={() => moveLotFocus(-1)} disabled={!canGoBack}>
                    Back Lot
                  </button>
                  <button type="button" onClick={() => moveLotFocus(1)} disabled={!canGoForward}>
                    Forward Lot
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
            {selectedAuction ? (
              <div className="inline-actions">
                <button type="button" onClick={() => resetAuctionReview(selectedAuction.auctionId)}>
                  Reset Decisions
                </button>
              </div>
            ) : null}
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

function formatDecisionLabel(decision: SwipeDecision | undefined): string {
  if (decision === 'saved') {
    return 'Saved'
  }

  if (decision === 'ignored') {
    return 'Ignored'
  }

  return 'Unreviewed'
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
