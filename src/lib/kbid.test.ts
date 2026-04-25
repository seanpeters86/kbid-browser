import { browseAuctionList, normalizeAuctionInput, refreshAuctionData } from './kbid'

function okHtmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
}

describe('normalizeAuctionInput', () => {
  it('normalizes numeric auction IDs', () => {
    expect(normalizeAuctionInput('  123456  ')).toEqual({
      auctionId: '123456',
      auctionUrl: 'https://www.k-bid.com/auction/123456',
    })
  })

  it('normalizes auction URLs', () => {
    expect(normalizeAuctionInput('https://www.k-bid.com/auction/98765?foo=bar')).toEqual({
      auctionId: '98765',
      auctionUrl: 'https://www.k-bid.com/auction/98765',
    })
  })

  it('rejects invalid inputs', () => {
    expect(normalizeAuctionInput('not-an-auction')).toBeNull()
    expect(normalizeAuctionInput('https://example.com/auction/123')).toBeNull()
  })
})

describe('browseAuctionList', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds browse URL and parses auction cards', async () => {
    const html = `
      <div class="panel panel-default">
        <a href="/auction/33333">Huge Estate Sale - Tools and Gear</a>
        <div><i title="Location"></i> Location: Saint Paul, MN</div>
        <div><i title="Distance"></i> Distance: 12.5 mi</div>
        <div class="auction-listing-timer">
          <b>Begins Closing</b>
          <span title="Friday, April 24, 2026 7:00 PM">Friday, April 24, 2026 7:00 PM</span>
        </div>
        <a href="/auction/33333/item/1"><img src="/img/M_1.jpg" /></a>
        <a href="/auction/33333/item/2"><img src="/img/M_2.jpg" /></a>
      </div>
    `

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okHtmlResponse(html))

    const result = await browseAuctionList({ distanceRadius: '25', distanceZip: '55014' }, '')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.url).toContain('/auction/list?')
    expect(result.url).toContain('distance_radius=25')
    expect(result.url).toContain('distance_zip=55014')
    expect(result.auctions).toHaveLength(1)
    expect(result.auctions[0]).toMatchObject({
      auctionId: '33333',
      auctionUrl: 'https://www.k-bid.com/auction/33333',
      location: 'Saint Paul, MN',
      distanceAway: '12.5 mi',
    })
    expect(result.auctions[0].imageUrls).toEqual([
      'https://www.k-bid.com/img/1.jpg',
      'https://www.k-bid.com/img/2.jpg',
    ])
  })
})

describe('refreshAuctionData', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches all pages and parses lots', async () => {
    const firstPageHtml = `
      <h1>Warehouse Liquidation</h1>
      <div>Showing 1 to 50 of 60 items</div>
      <div class="row">
        <a href="/auction/123/item/1">Cordless Drill</a>
        <a href="/auction/123/item/1"><img src="/images/M_1001.jpg" /></a>
        <div>Current Bid: $10.00 Next Bid: $12.00 High Bidder: Bidder1</div>
        <div>Begins Closing: Fri, Apr 24, 2026 7:00 PM Time Remaining: 1d 2h</div>
        <div>Lot Categories: Tools</div>
      </div>
    `

    const secondPageHtml = `
      <div class="row">
        <a href="/auction/123/item/51">Shop Vacuum</a>
        <a href="/auction/123/item/51"><img src="/images/M_2051.jpg" /></a>
        <div>Current Bid: $25.00 Next Bid: $27.50 High Bidder: Bidder9</div>
        <div>Begins Closing: Fri, Apr 24, 2026 8:00 PM Time Remaining: 5h 30m</div>
        <div>Lot Categories: Household</div>
      </div>
    `

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('page=2')) {
        return okHtmlResponse(secondPageHtml)
      }
      return okHtmlResponse(firstPageHtml)
    })

    const result = await refreshAuctionData('123', 'https://www.k-bid.com/auction/123', '')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.title).toBe('Warehouse Liquidation')
    expect(result.pageCount).toBe(2)
    expect(result.lots).toHaveLength(2)
    expect(result.lots[0]).toMatchObject({
      id: '1',
      title: 'Cordless Drill',
      lotNumber: 1,
      currentBid: 10,
      nextBid: 12,
      category: 'Tools',
      imageUrl: 'https://www.k-bid.com/images/1001.jpg',
    })
    expect(result.lots[1]).toMatchObject({
      id: '51',
      title: 'Shop Vacuum',
      lotNumber: 51,
      currentBid: 25,
      nextBid: 27.5,
      category: 'Household',
      imageUrl: 'https://www.k-bid.com/images/2051.jpg',
    })
    expect(result.warnings).toEqual([])
  })
})
