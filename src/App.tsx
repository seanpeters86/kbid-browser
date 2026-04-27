import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
const PREFETCH_COUNT = 3
const DEFAULT_BROWSE_FILTERS: AuctionBrowseFilters = {
  distanceRadius: '10',
  distanceZip: '55014',
}

function formatRemovalDateRange(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.replace(/\s+/g, ' ').trim()
  const match = normalized.match(
    /(((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s*)?[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\s*\d{1,2}:\d{2}\s*[AP]M\s*(?:-|to)\s*\d{1,2}:\d{2}\s*[AP]M)/i,
  )

  if (!match?.[1]) {
    return undefined
  }

  return match[1].replace(/(\d{4})(\d{1,2}:\d{2}\s*[AP]M\b)/i, '$1 $2')
}

function formatAuctionLocation(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  return value
    .replace(/^Auction\s+Location\s*:\s*/i, '')
    .replace(/^Location\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatCityFromLocation(value: string | undefined): string | undefined {
  const full = formatAuctionLocation(value)
  if (!full) {
    return undefined
  }

  const parts = full.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 1) {
    return parts[0]
  }

  // If the first part starts with a digit it's a street address; city is the next part
  return /^\d/.test(parts[0]) ? parts[1] : parts[0]
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
  const [importingAuctionId, setImportingAuctionId] = useState<string | null>(null)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [swipeCue, setSwipeCue] = useState<'left' | 'right' | null>(null)
  const [loadedSwipeImageLotId, setLoadedSwipeImageLotId] = useState<string | null>(null)
  const [focusedLotId, setFocusedLotId] = useState<string | null>(null)
  const prefetchedUrls = useRef<Set<string>>(new Set())

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

  const isDeckComplete = !currentLot && allLots.length > 0
  const canGoBack = currentLotIndex > 0 || isDeckComplete
  const canGoForward = currentLotIndex >= 0 || isDeckComplete
  const currentLotDecision = currentLot && selectedAuction ? selectedAuctionDecisions[currentLot.id] : undefined

  const reviewedCount = allLots.length - undecidedLots.length
  const progressPct = allLots.length ? Math.round((reviewedCount / allLots.length) * 100) : 0

  const setLotDecision = useCallback((lotId: string, decision: SwipeDecision | undefined) => {
    if (!selectedAuction) {
      return
    }

    setAuctionDecisions((prev) => {
      const auctionDecisionMap = prev[selectedAuction.auctionId] ?? {}
      const nextAuctionDecisionMap = { ...auctionDecisionMap }

      if (decision) {
        nextAuctionDecisionMap[lotId] = decision
      } else {
        delete nextAuctionDecisionMap[lotId]
      }

      const next = {
        ...prev,
        [selectedAuction.auctionId]: nextAuctionDecisionMap,
      }

      saveAuctionDecisions(next)
      return next
    })
  }, [selectedAuction])

  const moveLotFocus = useCallback((delta: number, cue?: 'left' | 'right', skipAutoIgnore = false) => {
    if (!allLots.length) {
      return
    }

    const move = () => {
      if (!currentLot) {
        if (delta < 0) {
          setFocusedLotId(allLots[allLots.length - 1].id)
        } else if (delta > 0) {
          setFocusedLotId(allLots[0].id)
        }
        return
      }

      const index = allLots.findIndex((lot) => lot.id === currentLot.id)
      if (index < 0) {
        return
      }

      if (delta > 0 && !skipAutoIgnore && selectedAuctionDecisions[currentLot.id] !== 'saved') {
        setLotDecision(currentLot.id, 'ignored')
      }

      const target = allLots[index + delta]
      if (!target) {
        if (delta > 0) {
          setFocusedLotId(null)
        }
        return
      }

      setFocusedLotId(target.id)
    }

    if (!cue) {
      move()
      return
    }

    setSwipeCue(cue)
    window.setTimeout(() => {
      setSwipeCue(null)
      move()
    }, 120)
  }, [allLots, currentLot, selectedAuctionDecisions, setLotDecision])

  const favoriteCurrentLot = useCallback(() => {
    if (!currentLot) {
      return
    }

    setLotDecision(currentLot.id, 'saved')
    moveLotFocus(1, 'right', true)
  }, [currentLot, moveLotFocus, setLotDecision])

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
        moveLotFocus(-1, 'left')
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveLotFocus(1, 'right')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView, currentLot, moveLotFocus, selectedAuction])

  useEffect(() => {
    if (activeView !== 'swipe' || currentLotIndex < 0) {
      return
    }

    const nextLots = allLots.slice(currentLotIndex + 1, currentLotIndex + 1 + PREFETCH_COUNT)
    for (const lot of nextLots) {
      if (lot.imageUrl && !prefetchedUrls.current.has(lot.imageUrl)) {
        prefetchedUrls.current.add(lot.imageUrl)
        const img = new Image()
        img.src = lot.imageUrl
      }
    }
  }, [activeView, allLots, currentLotIndex])

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

  const importAndSwipeAuction = async (auctionUrl: string, label?: string) => {
    const normalized = normalizeAuctionInput(auctionUrl)
    if (!normalized) return

    setImportingAuctionId(normalized.auctionId)

    let entry = trackedAuctions.find((e) => e.auctionId === normalized.auctionId)
    let currentList = trackedAuctions

    if (!entry) {
      entry = {
        id: crypto.randomUUID(),
        auctionId: normalized.auctionId,
        auctionUrl: normalized.auctionUrl,
        label,
        addedAt: new Date().toISOString(),
      }
      currentList = [entry, ...trackedAuctions]
      setTrackedAuctions(currentList)
      saveTrackedAuctions(currentList)
    }

    const targetId = entry.id
    selectAuction(targetId)

    if (entry.data) {
      setActiveView('swipe')
      setImportingAuctionId(null)
      return
    }

    setLoadingAuctionId(targetId)

    try {
      const data = await refreshAuctionData(entry.auctionId, entry.auctionUrl, settings.proxyPrefix)
      const nextAuctions = currentList.map((a) =>
        a.id === targetId ? { ...a, data, lastRefreshAt: new Date().toISOString(), lastError: undefined } : a,
      )
      setTrackedAuctions(nextAuctions)
      saveTrackedAuctions(nextAuctions)
      setActiveView('swipe')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed'
      const hint =
        ' Try setting a proxy prefix to work around CORS. Use the AllOrigins or corsproxy.io preset in Settings, or clear the proxy and try again if one is already set.'
      const nextAuctions = currentList.map((a) =>
        a.id === targetId ? { ...a, lastError: `${message}.${hint}` } : a,
      )
      setTrackedAuctions(nextAuctions)
      saveTrackedAuctions(nextAuctions)
    } finally {
      setLoadingAuctionId(null)
      setImportingAuctionId(null)
    }
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
      moveLotFocus(1, 'right')
      return
    }

    moveLotFocus(-1, 'left')
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
                        <a
                          className="browse-open-link"
                          href={auction.auctionUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open on K-BID"
                          title="Open on K-BID"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </a>
                        <div className="browse-card-info">
                          <strong title={auction.title}>{auction.abbreviatedTitle}</strong>
                          <p>{formatCityFromLocation(auction.location) ?? 'Location unavailable'}</p>
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
                          <button
                            type="button"
                            className="browse-swipe-btn"
                            disabled={importingAuctionId !== null}
                            onClick={() => void importAndSwipeAuction(auction.auctionUrl, auction.abbreviatedTitle)}
                          >
                            {importingAuctionId === auction.auctionId
                              ? 'Loading…'
                              : existing
                                ? 'Swipe →'
                                : 'Import & Swipe →'}
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
              {trackedAuctions.map((auction) => {
                const removalDate = formatRemovalDateRange(auction.data?.removalDate)

                return (
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
                      {removalDate ? (
                        <small className="auction-removal-time">Removal Time: {removalDate}</small>
                      ) : null}
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
                )
              })}
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
                  <div className="swipe-header-info">
                    <h2 className="swipe-auction-title">{selectedAuction.data.title}</h2>
                    <p className="swipe-auction-meta">
                      {[
                        formatCityFromLocation(selectedAuction.data.location)
                          ? `Location: ${formatCityFromLocation(selectedAuction.data.location)}`
                          : undefined,
                        formatRemovalDateRange(selectedAuction.data.removalDate)
                          ? `Removal Time: ${formatRemovalDateRange(selectedAuction.data.removalDate)}`
                          : undefined,
                      ]
                        .filter((part): part is string => Boolean(part))
                        .join(' • ') || 'Location and removal time unavailable'}
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
                      <div className="swipe-image-link" onDoubleClick={favoriteCurrentLot}>
                        <div className="lot-chip lot-chip-overlay">Lot {currentLot.lotNumber}</div>
                        {currentLotDecision === 'saved' || currentLotDecision === 'ignored' ? (
                          <div
                            className={`decision-chip-overlay ${currentLotDecision}`}
                            aria-label={formatDecisionLabel(currentLotDecision)}
                            title={formatDecisionLabel(currentLotDecision)}
                          >
                            {currentLotDecision === 'saved' ? '✓' : '✕'}
                          </div>
                        ) : null}
                        {currentLot.nextBid !== undefined ? (
                          <div
                            className="price-chip-overlay"
                            title={formatBidSummary(currentLot.currentBid, currentLot.nextBid)}
                          >
                            {formatMoney(currentLot.nextBid)}
                          </div>
                        ) : null}
                        {(() => {
                          const timeShort = formatTimeShort(currentLot.timeRemaining)
                          if (timeShort) {
                            return (
                              <div
                                className="time-chip-overlay"
                                aria-label={`Time remaining: ${currentLot.timeRemaining}`}
                                title={`Time remaining: ${currentLot.timeRemaining}`}
                              >
                                {timeShort}
                              </div>
                            )
                          }
                          if (currentLot.beginsClosing) {
                            return (
                              <div
                                className="time-chip-overlay"
                                aria-label={`Begins closing: ${currentLot.beginsClosing}`}
                                title={`Begins closing: ${currentLot.beginsClosing}`}
                              >
                                {currentLot.beginsClosing}
                              </div>
                            )
                          }
                          return null
                        })()}
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
                    </div>
                    <div className="swipe-content">
                      <div className="swipe-lot-header">
                        <h3>{currentLot.title}</h3>
                        <a
                          className="swipe-open-link"
                          href={currentLot.itemUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open lot listing"
                          title="Open lot listing"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </a>
                      </div>
                    </div>
                  </article>
                ) : (
                  <div className="empty-state compact">
                    <h3>Deck complete</h3>
                    <p>You reviewed every parsed lot. Open Favorites to decide what to bid on.</p>
                    <button type="button" onClick={() => setActiveView('saved')}>
                      Go to Favorites
                    </button>
                  </div>
                )}

                <div className="decision-row">
                  <button type="button" className="decision save" onClick={favoriteCurrentLot} disabled={!currentLot}>
                    Favorite
                  </button>
                </div>

                <div className="history-row">
                  <button type="button" onClick={() => moveLotFocus(-1, 'left')} disabled={!canGoBack}>
                    Back
                  </button>
                  <button type="button" onClick={() => moveLotFocus(1, 'right')} disabled={!canGoForward}>
                    Forward
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
                    <div className="saved-image-wrap">
                      {lot.imageUrl ? (
                        <img src={lot.imageUrl} alt={lot.title} className="saved-image" />
                      ) : (
                        <div className="image-placeholder small">No image</div>
                      )}
                     {(() => {
                        const timeShort = formatTimeShort(lot.timeRemaining)
                        if (timeShort) {
                          return (
                            <div
                              className="time-chip-overlay"
                              aria-label={`Time remaining: ${lot.timeRemaining}`}
                              title={`Time remaining: ${lot.timeRemaining}`}
                            >
                              {timeShort}
                            </div>
                          )
                        }
                        if (lot.beginsClosing) {
                          return (
                            <div
                              className="time-chip-overlay"
                              aria-label={`Begins closing: ${lot.beginsClosing}`}
                              title={`Begins closing: ${lot.beginsClosing}`}
                            >
                              {lot.beginsClosing}
                            </div>
                          )
                        }
                        return null
                      })()}
                    </div>
                    <div>
                      <div className="lot-chip">Lot {lot.lotNumber}</div>
                      <h3>{lot.title}</h3>
                      <p className="pricing">{formatBidSummary(lot.currentBid, lot.nextBid)}</p>
                    </div>
                    <div className="inline-actions">
                      <a className="link-button open-to-bid-button" href={lot.itemUrl} target="_blank" rel="noreferrer">
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

function formatTimeShort(timeRemaining: string | undefined): string | null {
  if (!timeRemaining) return null

  const daysMatch = timeRemaining.match(/(\d+)\s*d/i)
  const hoursMatch = timeRemaining.match(/(\d+)\s*h/i)
  const minutesMatch = timeRemaining.match(/(\d+)\s*m/i)

  const d = daysMatch ? Number.parseInt(daysMatch[1], 10) : 0
  const h = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : 0
  const m = minutesMatch ? Number.parseInt(minutesMatch[1], 10) : 0

  if (d > 0) return `${d}d`
  if (h > 0) return `${h}h`
  if (m > 0) return `${m}m`

  return null
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
