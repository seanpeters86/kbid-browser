import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import type { AuctionData } from './types'

const mockBrowseAuctionList = vi.fn()
const mockNormalizeAuctionInput = vi.fn()
const mockRefreshAuctionData = vi.fn()

vi.mock('./lib/kbid', () => ({
  browseAuctionList: (...args: unknown[]) => mockBrowseAuctionList(...args),
  normalizeAuctionInput: (...args: unknown[]) => mockNormalizeAuctionInput(...args),
  refreshAuctionData: (...args: unknown[]) => mockRefreshAuctionData(...args),
}))

const parsedAuctionData: AuctionData = {
  auctionId: '12345',
  auctionUrl: 'https://www.k-bid.com/auction/12345',
  title: 'Test Auction',
  pageCount: 1,
  lots: [
    {
      id: '1',
      lotNumber: 1,
      title: 'Test Lot',
      itemUrl: 'https://www.k-bid.com/auction/12345/item/1',
    },
  ],
  warnings: [],
  fetchedAt: '2026-04-24T00:00:00.000Z',
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()

    mockBrowseAuctionList.mockResolvedValue({
      url: 'https://www.k-bid.com/auction/list?distance_radius=10&distance_zip=55014',
      auctions: [],
    })
    mockNormalizeAuctionInput.mockReturnValue(null)
    mockRefreshAuctionData.mockResolvedValue(parsedAuctionData)
  })

  it('shows validation error for invalid auction input', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByPlaceholderText('Paste K-BID auction URL or ID'), 'bad-input')
    await user.click(screen.getByRole('button', { name: 'Add Auction' }))

    expect(await screen.findByText('Enter a valid K-BID auction URL or numeric auction ID.')).toBeInTheDocument()
  })

  it('imports and refreshes an auction, enabling swipe view', async () => {
    const user = userEvent.setup()

    mockNormalizeAuctionInput.mockReturnValue({
      auctionId: '12345',
      auctionUrl: 'https://www.k-bid.com/auction/12345',
    })

    render(<App />)

    await user.type(screen.getByPlaceholderText('Paste K-BID auction URL or ID'), '12345')
    await user.click(screen.getByRole('button', { name: 'Add Auction' }))

    expect(screen.getByText('Auction 12345')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(mockRefreshAuctionData).toHaveBeenCalledWith('12345', 'https://www.k-bid.com/auction/12345', 'https://corsproxy.io/?url=')
    })

    expect(screen.getByRole('button', { name: '2. Swipe' })).toBeEnabled()
    expect(screen.getByText('Test Auction')).toBeInTheDocument()
  })

  it('runs auction browse with default filters', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Search Auctions' }))

    await waitFor(() => {
      expect(mockBrowseAuctionList).toHaveBeenCalledWith(
        { distanceRadius: '10', distanceZip: '55014' },
        'https://corsproxy.io/?url=',
      )
    })
  })

  it('opens favorites from deck complete empty state', async () => {
    const user = userEvent.setup()

    mockNormalizeAuctionInput.mockReturnValue({
      auctionId: '12345',
      auctionUrl: 'https://www.k-bid.com/auction/12345',
    })

    render(<App />)

    await user.type(screen.getByPlaceholderText('Paste K-BID auction URL or ID'), '12345')
    await user.click(screen.getByRole('button', { name: 'Add Auction' }))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('Test Lot')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Ignore (←)' }))

    expect(await screen.findByRole('button', { name: 'Go to Favorites' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to Favorites' }))

    expect(screen.getByRole('heading', { name: 'Favorites' })).toBeInTheDocument()
    expect(screen.getByText('No favorites yet')).toBeInTheDocument()
  })

  it('allows history navigation from deck complete state', async () => {
    const user = userEvent.setup()

    mockNormalizeAuctionInput.mockReturnValue({
      auctionId: '12345',
      auctionUrl: 'https://www.k-bid.com/auction/12345',
    })

    render(<App />)

    await user.type(screen.getByPlaceholderText('Paste K-BID auction URL or ID'), '12345')
    await user.click(screen.getByRole('button', { name: 'Add Auction' }))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('Test Lot')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Ignore (←)' }))

    expect(await screen.findByText('Deck complete')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Test Lot')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ignore (←)' }))
    expect(await screen.findByText('Deck complete')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Forward' }))
    expect(screen.getByText('Test Lot')).toBeInTheDocument()
  })
})
