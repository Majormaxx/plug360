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
| DealEscrow | `0xe2C6D195f97ae281cca31deb0e4CeB92EB56b498` | deployed 2026-11-01, tx `0x1bc91a60` |
| PlugStake | `0x3D24B7D4867161adecF8eDaE2De0E4cCCC9f1Ed7` | deployed 2026-11-01, tx `0xf08c529f` |

> Mainnet DealEscrow uses the new 3-arg `setPlugLevel(address, uint8, string)` with `PlugLevelSet(plug, level, profileCid)`. IPFS CID pipeline is live once keeper is pointed at mainnet.

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
2. ~~Deploy PlugStake to Arc mainnet~~ — done at `0x3D24B7D4867161adecF8eDaE2De0E4cCCC9f1Ed7`.
3. Set `KEEPER_STATS_URL` in web env once keeper is deployed.
4. Point `CID_STORE_PATH` and `REVIEWS_DB_PATH` to persistent storage before production.
5. Move DealEscrow owner to a 2-of-3 Safe (M-02 from security review).
