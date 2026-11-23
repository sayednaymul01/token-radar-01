// Token launch radar model — an original valuation and farming model for
// protocols that record no token yet. Every number on the board is derived
// from the sealed snapshot's own fields (TVL, seven-day change, the day
// DefiLlama began tracking the protocol, its category and its chains);
// nothing is looked up and no protocol is favoured by name.
//
// Implied value = TVL x category multiple x growth factor x maturity factor.
//
// - The category multiple is the share of TVL a token for that kind of
//   protocol might plausibly be worth at issue: chains and payment networks
//   carry the richest multiples, vault and farming categories the thinnest.
// - The growth factor rewards a protocol whose TVL is rising into a launch
//   and discounts one that is shrinking: 1 + 0.55 x (change_7d / 100),
//   clamped to [0.5, 1.9]; an unreported change counts as neutral.
// - The maturity factor is a saturating bonus for time survived with no
//   token: 1 + 0.4 x (1 - exp(-age_days / 600)). A protocol tracked for
//   years has a record a launch can be priced on; a new one has only size.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** What one board row claims, plus the working the dashboard shows. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  growth_factor: number;
  maturity_factor: number;
  watchlist: boolean;
  tier: 'anchor' | 'radar';
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  mcap_usd: number;
  tvl_usd: number;
  mcap_to_tvl: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocol_count: number;
  pre_token_count: number;
  rows: BoardRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;

/** Days from the day DefiLlama began tracking a protocol to the snapshot day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = Date.parse(`${listedAt}T00:00:00Z`);
  const to = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/** The share of TVL a token for this kind of protocol might be worth at issue. */
export const CATEGORY_MULTIPLE: Record<string, number> = {
  Chain: 1.5,
  Payments: 1.1,
  Launchpad: 1.1,
  'Prediction Market': 1.2,
  Privacy: 1.0,
  Derivatives: 1.0,
  Synthetics: 0.9,
  Options: 0.9,
  'Interest Rate Derivatives': 0.9,
  RWA: 0.9,
  Dexs: 0.85,
  Restaking: 0.8,
  Lending: 0.75,
  Insurance: 0.7,
  CDP: 0.65,
  'CDP Manager': 0.65,
  Indexes: 0.6,
  'Risk Curators': 0.55,
  'Onchain Capital Allocator': 0.55,
  'Liquidity Manager': 0.55,
  Yield: 0.5,
  'Yield Aggregator': 0.5,
  'Staking Pool': 0.5,
  'Basis Trading': 0.45,
  'Leveraged Farming': 0.4,
  Farm: 0.4,
  'Decentralized AI': 1.2,
  'AI Agents': 1.2,
};
export const DEFAULT_MULTIPLE = 0.6;

export function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const raw = 1 + 0.55 * (change7d / 100);
  return Math.min(1.9, Math.max(0.5, raw));
}

export function maturityFactor(age: number | null): number {
  if (age === null) return 1;
  return 1 + 0.4 * (1 - Math.exp(-age / 600));
}

/** The model's three factors and the implied value they produce. */
export function impliedValue(p: SnapshotProtocol, asOf: string): {
  implied: number;
  multiple: number;
  growth: number;
  maturity: number;
  age: number | null;
} {
  const multiple = CATEGORY_MULTIPLE[p.category ?? ''] ?? DEFAULT_MULTIPLE;
  const growth = growthFactor(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const maturity = maturityFactor(age);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity));
  return { implied, multiple, growth, maturity, age };
}

/** A protocol records no token when both token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * A protocol is a launch candidate when it records no token and is not a
 * wrapped, staked, bridged or exchange product of something that already
 * trades — the same reading the house's watchlist makes, applied to every
 * protocol in the snapshot, not only those above the floor.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole dollars with thousands separators, for plan text. */
function usd(n: number): string {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Suggested working capital, scaled to the protocol's size. */
function capitalFor(tvl: number): number {
  if (tvl >= 500_000_000) return 2500;
  if (tvl >= 100_000_000) return 1500;
  if (tvl >= 25_000_000) return 750;
  return 400;
}

/** Weeks of steady activity the plan asks for, shorter for older protocols. */
function planWeeks(age: number | null): number {
  if (age === null) return 12;
  if (age >= 720) return 8;
  if (age >= 365) return 10;
  return 12;
}

const MAINNET_CHAINS = new Set(['Ethereum', 'Bitcoin', 'Solana']);

/** The core product action for a category, written as an instruction. */
function coreAction(category: string | null, name: string): string {
  switch (category) {
    case 'Dexs':
      return `Trade on ${name} itself: swap the main pairs in both directions and park a small two-sided LP position in its deepest pool, so your wallet shows real flow rather than one visit`;
    case 'Lending':
    case 'Uncollateralized Lending':
      return `Supply blue-chip collateral (ETH or a major stablecoin) on ${name} and borrow against it under 60% loan-to-value, then re-supply the borrowed asset once to build a genuine position history`;
    case 'CDP':
    case 'CDP Manager':
      return `Open a vault on ${name}: deposit ETH or stETH as collateral above 180% collateralisation and mint a modest amount of its stablecoin, then hold or park the minted coins in its own stability pool`;
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
    case 'Leveraged Farming':
      return `Deposit into ${name}'s flagship vault and leave auto-compounding on; add a second, smaller deposit a few weeks later so the wallet reads as a returning user, not a drive-by`;
    case 'Derivatives':
    case 'Options':
    case 'Interest Rate Derivatives':
      return `Trade small, real size on ${name} every week — open and close modest perpetual or options positions and pay the funding and fees; consistent volume history is what these launches usually reward`;
    case 'Chain':
      return `Bridge funds onto the chain and use at least three native apps a week — a swap, a lend and a transfer — so the wallet looks like a resident of the chain, not a tourist`;
    case 'RWA':
      return `Buy ${name}'s tokenised treasury or credit product with the working capital and hold it; add the product's own yield or points programme if one is running and keep the position whole`;
    case 'Restaking':
    case 'Staking Pool':
      return `Stake ETH (or the accepted liquid staking token) through ${name} and hold the receipt position; restake once into a single operator or vault rather than spreading thin`;
    case 'Payments':
      return `Route real payments through ${name}: load the account, pay for something genuine each week and keep a balance parked instead of sweeping it out after every use`;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Collateral Markets':
      return `Deposit into a flagship vault ${name} curates — a major stablecoin or ETH vault, not an exotic one — and hold the vault shares; add a second deposit weeks later and never chase the highest-yield vault it lists`;
    case 'Basis Trading':
      return `Fund ${name}'s basis vault with the working capital and hold the position whole; the strategy needs weeks to accrue, so do not redeem and re-enter around small funding swings`;
    case 'Synthetics':
    case 'Launchpad':
      return `Take part in ${name}'s core market with real funds — mint, trade or back an issue in modest size each week — and hold a standing position so the wallet predates any launch snapshot`;
    case 'Prediction Market':
      return `Trade ${name}'s markets weekly in small size on questions you have actually read; a record of many settled, sensible positions is worth more than one large bet`;
    case 'Insurance':
      return `Buy cover on ${name} for a position you really hold elsewhere and stake a small amount in its underwriting pool if it offers one; both sides of the book are plausible launch records`;
    case 'Liquidity Manager':
    case 'Indexes':
      return `Buy and hold ${name}'s managed position or index with the working capital, then rebalance only when it does; a long, unbroken holding period is the record to build`;
    case 'Privacy':
    case 'Decentralized AI':
    case 'AI Agents':
      return `Use ${name}'s privacy or compute feature for real tasks every week — shielded transfers, paid inference or agent runs — and keep a working balance in the product between sessions`;
    case 'Anchor BTC':
    case 'Decentralized BTC':
    case 'Dual-Token Stablecoin':
    case 'Stablecoin Wrapper':
      return `Deposit BTC or the accepted collateral into ${name} and hold the issued asset in the same wallet; mint and hold beats mint and dump if a launch ever reads the holder list`;
    case 'Crypto Card Issuer':
    case 'CeDeFi':
    case 'OTC Marketplace':
    case 'Governance Incentives':
      return `Use ${name} the way a customer would: complete its onboarding, transact in real size a few times a month and keep a balance or open position with it between uses`;
    case 'Cross Chain Bridge':
      return `Bridge real funds through ${name} in both directions a few times a month and use a destination-chain app after each crossing, so the history is usage rather than empty hops`;
    default:
      return `Use ${name}'s core product with real funds two or three times a week — the deposit, trade or position its interface leads with — and keep the position open between sessions`;
  }
}

/**
 * A concrete farming plan for one protocol: what to set up, what to do,
 * how long for, what it costs and when to walk away. Every figure comes
 * from the protocol's own snapshot row.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const weeks = planWeeks(age);
  const gas = MAINNET_CHAINS.has(chain)
    ? 'Budget $25–$60 a month for gas at mainnet prices and batch actions into fewer, larger transactions'
    : `Gas on ${chain} is cheap: budget $1–$10 a month and act in small, regular sessions instead of one large one`;
  const ageNote =
    age === null
      ? 'DefiLlama gives no start date for it, so treat the record as unproven'
      : age >= 365
        ? `It has run ${Math.floor(age / 30)} months with no token, so the record behind a launch is long`
        : `It has been tracked for ${age} days, so the record behind a launch is still short`;
  return [
    `Set up one wallet for ${p.name} on ${chain} and fund it with about ${usd(capital)} of working capital; keep this wallet for this protocol alone so any future distribution can read a clean history. ${ageNote}.`,
    coreAction(p.category, p.name),
    `Keep it up for ${weeks} weeks: three short sessions a week beats one monthly burst. ${gas}; total running cost over the plan should stay under ${usd(Math.max(30, Math.round(capital * 0.06)))}.`,
    `Join ${p.name}'s points, quest or waitlist programme if one is live and link this same wallet; follow its official announcements weekly and never split activity across extra wallets to look bigger.`,
    `Cap the position at 10% of your farming bankroll. Review on the last day of week ${weeks}: withdraw if TVL falls more than 25% in seven days, and if a token launches, read the claim terms before signing anything.`,
  ];
}

/** The board: every launch candidate, best implied value first, capped. */
export const MAX_ROWS = 240;

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isLaunchCandidate)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of) }))
    .sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = scored.slice(0, MAX_ROWS).map(({ p, v }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: v.implied,
    farm_steps: farmSteps(p, v.age),
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: v.age,
    multiple: v.multiple,
    growth_factor: round4(v.growth),
    maturity_factor: round4(v.maturity),
    watchlist: watch.has(p.slug),
    tier: p.tvl_usd >= snapshot.floor_usd ? 'anchor' : 'radar',
  }));
  return rows;
}

/** The largest tokenised protocols, for the dashboard's already-trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      mcap_usd: p.mcap_usd ?? 0,
      tvl_usd: p.tvl_usd,
      mcap_to_tvl: p.tvl_usd > 0 ? round4((p.mcap_usd ?? 0) / p.tvl_usd) : 0,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    pre_token_count: snapshot.protocols.filter(recordsNoToken).length,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected an object with protocols[] and watchlist[]');
  }
  return raw;
}

/** The first gate rule the board breaks, or null when it is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allSame = board.length > 1;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${i + 1}: implied value is not a positive whole number`;
    if (row.implied_value_usd > prev) return `row ${i + 1}: implied value rises as rank ascends`;
    if (i > 0 && row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3..12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  if (allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: the same board, with the working shown. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
