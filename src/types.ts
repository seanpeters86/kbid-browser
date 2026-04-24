export interface Lot {
  id: string
  lotNumber: number
  title: string
  itemUrl: string
  imageUrl?: string
  currentBid?: number
  nextBid?: number
  highBidder?: string
  beginsClosing?: string
  timeRemaining?: string
  category?: string
}

export interface AuctionData {
  auctionId: string
  auctionUrl: string
  title: string
  totalLots?: number
  pageCount: number
  lots: Lot[]
  warnings: string[]
  fetchedAt: string
}

export interface TrackedAuction {
  id: string
  auctionId: string
  auctionUrl: string
  label?: string
  addedAt: string
  lastRefreshAt?: string
  data?: AuctionData
  lastError?: string
}

export interface AppSettings {
  proxyPrefix: string
}

export type AuctionBrowseDistanceRadius = '10' | '25' | '50'

export interface AuctionBrowseFilters {
  distanceRadius: AuctionBrowseDistanceRadius
  distanceZip: string
}

export interface AuctionBrowseItem {
  auctionId: string
  auctionUrl: string
  title: string
  abbreviatedTitle: string
  location?: string
  distanceAway?: string
  closingDate?: string
  imageUrls: string[]
}

export type SwipeDecision = 'saved' | 'ignored'

export type AuctionDecisionStore = Record<string, Record<string, SwipeDecision>>

export type SortField =
  | 'lotNumber'
  | 'title'
  | 'currentBid'
  | 'nextBid'
  | 'beginsClosing'

export interface LotFilters {
  search: string
  minBid: string
  maxBid: string
  category: string
  endingSoonOnly: boolean
  sortField: SortField
  sortDirection: 'asc' | 'desc'
}
