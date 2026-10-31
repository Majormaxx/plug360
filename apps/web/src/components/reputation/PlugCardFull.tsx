'use client';

/**
 * Full reputation card for a plug address — shown on the /plugs/[address] page
 * and in the "inspect plug" sheet within the deal room.
 */
import { getAddress, type Address } from 'viem';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Notice } from '@/components/ui/Notice';
import { AddressText } from '@/components/ui/AddressText';
import { PlugStatBar } from './PlugStatBar';
import { ReviewList } from './ReviewList';
import { usePlugCard } from '@/hooks/usePlugCard';
import { usdc } from '@/lib/format';

const LEVEL_LABELS = ['', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'];

/**
 * `bare` — omit the outer Panel wrapper (for use inside a drawer where a border would double up).
 */
export function PlugCardFull({ address, bare = false }: { address: Address; bare?: boolean }) {
  const { card, loading, error } = usePlugCard(address);

  if (loading) {
    return (
      <Panel className="space-y-4 p-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-20 w-full" />
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="p-5">
        <Notice tone="danger">Could not load plug profile. Check your connection and try again.</Notice>
      </Panel>
    );
  }

  if (!card) return null;

  const { level, levelCap: cap, profile, stats, reviews, staked, withdrawRequest, avgRating } = card;

  const header = (
    <PanelHeader
      title={profile?.name ?? 'Plug'}
      sub={profile?.bio}
      aside={
        level > 0 ? (
          <Badge tone="gold" dot>{LEVEL_LABELS[level] ?? `Level ${level}`} · up to ${usdc(cap)}</Badge>
        ) : (
          <Badge tone="danger">Delisted</Badge>
        )
      }
    />
  );

  const inner = (
    <div className="space-y-5 p-5 pt-4">
        {/* Address */}
        <AddressText address={getAddress(address)} compact />

        {/* Staked */}
        {staked > 0n && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Staked</span>
            <Badge tone="mint">${usdc(staked)} USDC</Badge>
            {withdrawRequest && (
              <Badge tone="gold">Withdrawal pending</Badge>
            )}
          </div>
        )}
        {staked === 0n && (
          <Notice tone="warn">
            This plug has no stake. Staking is optional but adds skin-in-the-game accountability.
          </Notice>
        )}

        {/* Profile extras */}
        {profile && (
          <div className="flex flex-wrap gap-2 text-xs">
            {profile.specialty?.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}
            {profile.languages?.map((l) => <Badge key={l} tone="neutral">{l.toUpperCase()}</Badge>)}
            {profile.jurisdiction && <Badge tone="neutral">{profile.jurisdiction}</Badge>}
          </div>
        )}

        {/* Contact */}
        {profile?.contact && (
          <div className="flex flex-wrap gap-3 text-sm text-muted">
            {profile.contact.telegram && (
              <a href={`https://t.me/${profile.contact.telegram.replace('@', '')}`} target="_blank" rel="noreferrer" className="hover:text-ink">
                Telegram
              </a>
            )}
            {profile.contact.twitter && (
              <a href={`https://x.com/${profile.contact.twitter.replace('@', '')}`} target="_blank" rel="noreferrer" className="hover:text-ink">
                Twitter / X
              </a>
            )}
            {profile.contact.website && (
              <a href={profile.contact.website} target="_blank" rel="noreferrer" className="hover:text-ink">
                Website
              </a>
            )}
          </div>
        )}

        {/* Tier 1 stats */}
        {stats ? (
          <PlugStatBar stats={stats} avgRating={avgRating} reviewCount={reviews.length} />
        ) : (
          <p className="text-sm text-muted">No on-chain stats yet.</p>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Buyer reviews</h3>
            <ReviewList reviews={reviews} />
          </div>
        )}
      </div>
  );

  if (bare) {
    return (
      <div>
        {header}
        {inner}
      </div>
    );
  }

  return (
    <Panel>
      {header}
      {inner}
    </Panel>
  );
}
