import type { AuctionData, Lot } from '../types'

const AUCTION_URL_PATTERN = /k-bid\.com\/auction\/(\d+)/i
const AUCTION_ID_PATTERN = /^(\d{3,})$/
const ITEM_URL_PATTERN = /\/auction\/(\d+)\/item\/(\d+)/i
const MAX_FETCH_RETRIES = 3
const BASE_RETRY_DELAY_MS = 350
const FETCH_TIMEOUT_MS = 25000

export function normalizeAuctionInput(input: string): {
  auctionId: string
  auctionUrl: string
} | null {
  const normalized = input.trim()

  const idMatch = normalized.match(AUCTION_ID_PATTERN)
  if (idMatch) {
    const [, auctionId] = idMatch
    return {
      auctionId,
      auctionUrl: `https://www.k-bid.com/auction/${auctionId}`,
    }
  }

  let asUrl: URL
  try {
    asUrl = new URL(normalized)
  } catch {
    return null
  }

  const urlMatch = asUrl.href.match(AUCTION_URL_PATTERN)
  if (!urlMatch) {
    return null
  }

  const auctionId = urlMatch[1]
  return {
    auctionId,
    auctionUrl: `https://www.k-bid.com/auction/${auctionId}`,
  }
}

function toAbsoluteUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  if (url.startsWith('/')) {
    return `https://www.k-bid.com${url}`
  }

  return `https://www.k-bid.com/${url}`
}

function toProxiedUrl(url: string, proxyPrefix: string): string {
  if (!proxyPrefix.trim()) {
    return url
  }

  if (proxyPrefix.includes('{url}')) {
    return proxyPrefix.replace('{url}', encodeURIComponent(url))
  }

  return `${proxyPrefix}${encodeURIComponent(url)}`
}

function parseMoney(input: string | undefined): number | undefined {
  if (!input) {
    return undefined
  }

  const clean = input.replace(/[$,]/g, '').trim()
  const value = Number.parseFloat(clean)
  return Number.isFinite(value) ? value : undefined
}

function extractTextFromNode(node: Element | null): string {
  if (!node) {
    return ''
  }

  return node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function collectLotContextText(anchor: HTMLAnchorElement): string {
  const segments: string[] = []

  const row = anchor.closest('.row')
  if (row) {
    segments.push(extractTextFromNode(row))

    let sibling: Element | null = row.nextElementSibling
    let scanned = 0
    while (sibling && scanned < 4) {
      const className = sibling.className.toLowerCase()
      if (className.includes('lot-divider')) {
        break
      }

      segments.push(extractTextFromNode(sibling))
      sibling = sibling.nextElementSibling
      scanned += 1
    }
  } else {
    const container = anchor.closest('article, li, .item, .lot, .panel, .card, div')
    segments.push(extractTextFromNode(container))
  }

  return segments.join(' ').replace(/\s+/g, ' ').trim()
}

function pickBestTitle(anchor: HTMLAnchorElement): string {
  const anchorText = extractTextFromNode(anchor)
  if (anchorText && !/^lot:\s*\d+/i.test(anchorText)) {
    return anchorText
  }

  const parent = anchor.parentElement
  if (!parent) {
    return anchorText || 'Untitled lot'
  }

  const linkedAnchors = Array.from(parent.querySelectorAll('a'))
    .map((entry) => extractTextFromNode(entry))
    .filter((entry) => entry && !/^lot:\s*\d+/i.test(entry))
    .filter((entry) => !/click for details/i.test(entry))
    .sort((left, right) => right.length - left.length)

  return linkedAnchors[0] || anchorText || 'Untitled lot'
}

function extractImageSrc(img: HTMLImageElement): string | undefined {
  const rawUrl = img.getAttribute('src')
    || img.getAttribute('data-src')
    || img.getAttribute('data-original')
    || img.getAttribute('data-lazy')
  if (!rawUrl) {
    return undefined
  }

  const absolute = toAbsoluteUrl(rawUrl)
  const lower = absolute.toLowerCase()
  if (
    lower.includes('placeholder')
    || lower.includes('loading.gif')
    || lower.includes('blank.gif')
    || lower.endsWith('.ico')
  ) {
    return undefined
  }

  // K-BID CDN stores images with size prefixes: M_ = medium (listing page),
  // no prefix = full size. Strip M_ to get the higher-quality original.
  return absolute.replace(/(\/)[Mm]_(\d+\.(jpg|jpeg|png|webp))/i, '$1$2')
}

function parseLotFromContext(itemUrl: string, lotNumber: number, contextText: string): Partial<Lot> {
  const currentBidMatch = contextText.match(/Current\s*Bid:\s*\$?([\d,.]+)/i)
  const nextBidMatch = contextText.match(/Next(?:\s+Required)?\s*Bid:\s*\$?([\d,.]+)/i)
  const highBidderMatch = contextText.match(/High\s*Bidder:\s*(.*?)(?:Place\s*Bid|Begins\s*Closing:|$)/i)
  const beginsClosingMatch = contextText.match(/Begins\s*Closing:\s*(.*?)(?:Time\s*Remaining:|Current\s*Bid:|$)/i)
  const timeRemainingMatch = contextText.match(/Time\s*Remaining:\s*([\d]+\s*[dhm](?:\s*[\d]+\s*[hm]){0,2})/i)

  return {
    id: `${lotNumber}`,
    itemUrl,
    lotNumber,
    currentBid: parseMoney(currentBidMatch?.[1]),
    nextBid: parseMoney(nextBidMatch?.[1]),
    highBidder: highBidderMatch?.[1]?.trim(),
    beginsClosing: beginsClosingMatch?.[1]?.trim(),
    timeRemaining: timeRemainingMatch?.[1]?.trim(),
  }
}

function scoreLot(lot: Partial<Lot>): number {
  let score = 0
  if (lot.title) score += 2
  if (lot.currentBid !== undefined) score += 1
  if (lot.nextBid !== undefined) score += 1
  if (lot.beginsClosing) score += 1
  if (lot.timeRemaining) score += 1
  if (lot.highBidder) score += 1
  return score
}

function parseLotsFromHtml(html: string): Lot[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const anchorCandidates = Array.from(doc.querySelectorAll('a[href*="/auction/"][href*="/item/"]'))

  const lotsByKey = new Map<string, Lot>()

  for (const anchor of anchorCandidates) {
    if (!(anchor instanceof HTMLAnchorElement)) {
      continue
    }

    const itemUrl = toAbsoluteUrl(anchor.getAttribute('href') ?? '')
    const itemMatch = itemUrl.match(ITEM_URL_PATTERN)
    if (!itemMatch) {
      continue
    }

    const lotNumber = Number.parseInt(itemMatch[2], 10)
    if (!Number.isFinite(lotNumber)) {
      continue
    }

    const contextText = collectLotContextText(anchor)
    const parsed = parseLotFromContext(itemUrl, lotNumber, contextText)
    const title = pickBestTitle(anchor)

    const lotCandidate: Lot = {
      id: `${lotNumber}`,
      lotNumber,
      title,
      itemUrl,
      imageUrl: undefined,
      currentBid: parsed.currentBid,
      nextBid: parsed.nextBid,
      highBidder: parsed.highBidder,
      beginsClosing: parsed.beginsClosing,
      timeRemaining: parsed.timeRemaining,
      category: extractCategory(contextText),
    }

    const existing = lotsByKey.get(lotCandidate.id)
    if (!existing || scoreLot(lotCandidate) > scoreLot(existing)) {
      lotsByKey.set(lotCandidate.id, lotCandidate)
    }
  }

  // Second pass: assign images by finding <img> inside item-URL anchors.
  // K-BID puts the image in a sibling row from the title anchor, so we can't
  // find it via closest(). Instead, scan all anchors that link to an item URL
  // and look for an <img> inside them.
  const imageAnchors = Array.from(
    doc.querySelectorAll('a[href*="/item/"]'),
  ) as HTMLAnchorElement[]
  for (const anchor of imageAnchors) {
    const href = anchor.getAttribute('href') ?? ''
    const match = href.match(ITEM_URL_PATTERN)
    if (!match) {
      continue
    }

    const lotNumber = Number.parseInt(match[2], 10)
    const lot = lotsByKey.get(`${lotNumber}`)
    if (!lot || lot.imageUrl) {
      continue
    }

    const img = anchor.querySelector('img')
    if (!img || !(img instanceof HTMLImageElement)) {
      continue
    }

    const imageUrl = extractImageSrc(img)
    if (imageUrl) {
      lot.imageUrl = imageUrl
    }
  }

  return Array.from(lotsByKey.values()).sort((left, right) => left.lotNumber - right.lotNumber)
}

function extractCategory(contextText: string): string | undefined {
  const categoryMatch = contextText.match(/Lot Categories?:\s*([^\n\r]+)/i)
  if (categoryMatch?.[1]) {
    return categoryMatch[1].trim()
  }

  const breadcrumbMatch = contextText.match(/Household\s*&\s*Estate\s*>\s*([^\n\r]+)/i)
  return breadcrumbMatch?.[1]?.trim()
}

function parseAuctionTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const heading = doc.querySelector('h1')
  return extractTextFromNode(heading) || 'K-BID Auction'
}

function parseTotalLots(html: string): number | undefined {
  const text = html.replace(/\s+/g, ' ')
  const match = text.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+(\d+)\s+items/i)
  if (!match) {
    return undefined
  }

  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : undefined
}

async function fetchText(url: string): Promise<string> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
        },
      })

      if (!response.ok) {
        const httpError = new Error(`HTTP ${response.status}`)
        if (!isRetryableHttpStatus(response.status) || attempt === MAX_FETCH_RETRIES) {
          throw httpError
        }

        lastError = httpError
      } else {
        return response.text()
      }
    } catch (error) {
      const asError = error instanceof Error ? error : new Error('Unknown fetch error')
      if (asError.name === 'AbortError') {
        lastError = new Error('Request timed out')
      } else {
        lastError = asError
      }

      if (attempt === MAX_FETCH_RETRIES) {
        break
      }
    } finally {
      clearTimeout(timeoutId)
    }

    await sleep(getRetryDelayMs(attempt))
  }

  const message = lastError?.message ?? 'Unknown fetch error'
  throw new Error(`${message} (after ${MAX_FETCH_RETRIES + 1} attempts)`)
}

function isRetryableHttpStatus(status: number): boolean {
  // 408 = proxy/server timeout — retrying immediately rarely helps; skip retries
  return status === 425 || status === 429 || status >= 500
}

function getRetryDelayMs(attempt: number): number {
  const jitterMs = Math.floor(Math.random() * 120)
  return BASE_RETRY_DELAY_MS * 2 ** attempt + jitterMs
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchAuctionPage(auctionUrl: string, proxyPrefix: string): Promise<string> {
  const directUrl = toProxiedUrl(auctionUrl, proxyPrefix)
  return fetchText(directUrl)
}

function getAuctionPageUrl(baseAuctionUrl: string, pageNumber: number): string {
  if (pageNumber <= 1) {
    return baseAuctionUrl
  }

  const url = new URL(baseAuctionUrl)
  url.searchParams.set('page', String(pageNumber))
  return url.toString()
}

export async function refreshAuctionData(
  auctionId: string,
  auctionUrl: string,
  proxyPrefix: string,
): Promise<AuctionData> {
  const warnings: string[] = []
  const firstPageHtml = await fetchAuctionPage(auctionUrl, proxyPrefix)
  const totalLots = parseTotalLots(firstPageHtml)
  const pageCount = Math.max(1, Math.ceil((totalLots ?? 50) / 50))
  const auctionTitle = parseAuctionTitle(firstPageHtml)

  const allLots = new Map<string, Lot>()
  const firstPageLots = parseLotsFromHtml(firstPageHtml)
  for (const lot of firstPageLots) {
    allLots.set(lot.id, lot)
  }

  for (let page = 2; page <= pageCount; page += 1) {
    try {
      const pageUrl = getAuctionPageUrl(auctionUrl, page)
      const pageHtml = await fetchAuctionPage(pageUrl, proxyPrefix)
      const pageLots = parseLotsFromHtml(pageHtml)
      for (const lot of pageLots) {
        allLots.set(lot.id, lot)
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 150)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown page fetch error'
      warnings.push(`Page ${page} failed: ${message}`)
    }
  }

  const parsedLots = Array.from(allLots.values()).sort((left, right) => left.lotNumber - right.lotNumber)
  if (!parsedLots.length) {
    warnings.push('No lots were parsed. The page markup may have changed or CORS may be blocking access.')
  }

  return {
    auctionId,
    auctionUrl,
    title: auctionTitle,
    totalLots,
    pageCount,
    lots: parsedLots,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}
