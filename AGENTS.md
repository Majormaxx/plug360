# Agent notes — Plug360

## Deployed contracts

### Arc testnet (chainId 5042002)
| Contract | Address | Deployed |
|---|---|---|
| DealEscrow | `0xeba9e8018514826dab08233965e218df35c40940` | 2026-10-27 |
| PlugStake | `0x32b56e4657c450327124b8e8ae14789b327dbd61` | 2026-10-27 |
| USDC (native) | `0x3600000000000000000000000000000000000000` | — |
| Owner / council | `0x6FcCB3cf837a490A5dB9112770d46e395EeA88c9` | — |

### Arc mainnet (chainId 5042)
| Contract | Address |
|---|---|
| DealEscrow | `0xd173909Bc98DAf021669c56e5613Cd531903B0de` |
| PlugStake | not yet deployed |

> Mainnet DealEscrow still uses the old 2-arg `setPlugLevel(address, uint8)`. Redeployment required to enable the IPFS profile CID pipeline (see below).

## IPFS profile pipeline status

- `publishedAt` double-stamp bug: fixed (2026-10-27)
- CID store: `apps/web/src/lib/reputation/cid-store.ts` (JSON file, `CID_STORE_PATH` env)
- Lookup route: `GET /api/reputation/profile/lookup?plug=<address>`
- `usePlugCard`: reads CID from lookup route first, env var fallback
- Contract: `PlugLevelSet(plug, level, profileCid)` — testnet deployed, mainnet pending
- Keeper: reads `profileCid` from `PlugLevelSet` events, exposes in `/stats/plugs/:address`

## Environment variables (web app)

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `5042002` | testnet |
| `NEXT_PUBLIC_ESCROW` | `0xeba9e8018514826dab08233965e218df35c40940` | overrides deployment JSON |
| `NEXT_PUBLIC_PLUG_STAKE_ADDRESS` | `0x32b56e4657c450327124b8e8ae14789b327dbd61` | new |
| `PINATA_JWT` | set in `.env.local` | server-only, never commit |
| `KEEPER_STATS_URL` | not set | set when keeper is running |
| `CID_STORE_PATH` | unset (defaults to `/tmp/plug360-cids.json`) | swap for persistent path in production |
| `REVIEWS_DB_PATH` | unset (defaults to `/tmp/plug360-reviews.json`) | swap for persistent path in production |

## Pending (requires human action)

1. List plugs on the new testnet DealEscrow via `setPlugLevel(plug, level, "")` using the owner key.
2. Redeploy DealEscrow + PlugStake to Arc mainnet from the owner wallet.
3. Set `KEEPER_STATS_URL` in web env once keeper is deployed.
4. Point `CID_STORE_PATH` and `REVIEWS_DB_PATH` to persistent storage before production.
5. Move DealEscrow owner to a 2-of-3 Safe (M-02 from security review).
