'use client';

/**
 * Live-preview plug profile editor.
 * Left column: form fields (name, bio, specialty, languages, jurisdiction, contact).
 * Right column (desktop) / below (mobile): PlugCardFull preview that updates as you type.
 *
 * Publish flow:
 *   1. User fills form.
 *   2. "Publish" → sign EIP-191 message (profilePayload).
 *   3. POST /api/reputation/profile/publish → returns IPFS CID.
 *   4. Show CID with copy button + next-steps instructions.
 */
import { useCallback, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { getAddress, type Address } from 'viem';
import type { PlugProfile, PlugCard } from '@plug360/shared';
import { profilePayload as buildPayload } from '@/lib/reputation/profile';
import { Button } from '@/components/ui/Button';
import { Field, Input, TextArea } from '@/components/ui/Field';
import { Notice } from '@/components/ui/Notice';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { PlugCardFull } from './PlugCardFull';
import { cn } from '@/components/ui/cn';

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({
  value,
  onChange,
  placeholder,
  max = 5,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
}) {
  const [input, setInput] = useState('');

  function add() {
    const trimmed = input.trim();
    if (!trimmed || value.includes(trimmed) || value.length >= max) return;
    onChange([...value, trimmed]);
    setInput('');
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 rounded-[14px] border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <Button variant="soft" size="sm" onClick={add} disabled={!input.trim() || value.length >= max}>
          Add
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="flex items-center gap-1 rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-ink hover:bg-line-strong/60"
            >
              {tag}
              <span className="text-faint">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Preview wrapper ─────────────────────────────────────────────────────────

/**
 * A fake PlugCard that mirrors the live form state so the preview updates without
 * an API round-trip. The address and on-chain data come from the real hook;
 * profile is overridden with the form values.
 */
function LivePreview({ address, draft }: { address: Address; draft: Partial<PlugProfile> }) {
  // We render PlugCardFull normally but override the profile display by
  // rendering a static preview panel instead, because the real hook can't
  // accept an injected profile without a refactor. This keeps it simple.
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-faint">Preview</p>
      <Panel className="overflow-hidden">
        <PanelHeader
          title={draft.name || 'Your name'}
          sub={draft.bio}
          aside={<Badge tone="gold">Level · up to $? USDC</Badge>}
        />
        <div className="space-y-3 p-5 pt-3 text-sm">
          {(draft.specialty?.length ?? 0) > 0 || (draft.languages?.length ?? 0) > 0 || draft.jurisdiction ? (
            <div className="flex flex-wrap gap-1.5">
              {draft.specialty?.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}
              {draft.languages?.map((l) => <Badge key={l} tone="neutral">{l.toUpperCase()}</Badge>)}
              {draft.jurisdiction && <Badge tone="neutral">{draft.jurisdiction}</Badge>}
            </div>
          ) : null}
          {draft.contact && (Object.values(draft.contact).some(Boolean)) ? (
            <div className="flex flex-wrap gap-3 text-muted">
              {draft.contact.telegram && <span>Telegram</span>}
              {draft.contact.twitter && <span>Twitter / X</span>}
              {draft.contact.website && <span>Website</span>}
            </div>
          ) : null}
          <p className="text-xs text-faint">On-chain stats and reviews appear here once your profile is published.</p>
        </div>
      </Panel>
      <p className="text-xs text-faint">
        This preview is based on your form values. Your level badge and stats come from the chain after publishing.
      </p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

type FormState = {
  name: string;
  bio: string;
  specialty: string[];
  languages: string[];
  jurisdiction: string;
  telegram: string;
  twitter: string;
  website: string;
};

const EMPTY: FormState = {
  name: '',
  bio: '',
  specialty: [],
  languages: [],
  jurisdiction: '',
  telegram: '',
  twitter: '',
  website: '',
};

type PublishStatus = 'idle' | 'signing' | 'uploading' | 'done' | 'error';

export function PlugProfileEditor({ address }: { address: Address }) {
  const { signMessageAsync } = useSignMessage();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>('idle');
  const [publishedCid, setPublishedCid] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  const hasContent = form.name.trim().length > 0;

  // Derive the profile draft for preview.
  const draft: Partial<PlugProfile> = {
    name: form.name.trim() || undefined,
    bio: form.bio.trim() || undefined,
    specialty: form.specialty.length > 0 ? form.specialty : undefined,
    languages: form.languages.length > 0 ? form.languages : undefined,
    jurisdiction: form.jurisdiction || undefined,
    contact: {
      telegram: form.telegram.trim() || undefined,
      twitter: form.twitter.trim() || undefined,
      website: form.website.trim() || undefined,
    },
  };

  async function publish() {
    if (!hasContent) return;
    setPublishStatus('signing');
    setErrorMsg('');
    try {
      // publishedAt is stamped here so the plug signs the exact document the server stores.
      const profile: Omit<PlugProfile, 'signature'> = {
        address: getAddress(address),
        name: form.name.trim(),
        ...(form.bio.trim() && { bio: form.bio.trim() }),
        ...(form.specialty.length > 0 && { specialty: form.specialty }),
        ...(form.languages.length > 0 && { languages: form.languages }),
        ...(form.jurisdiction && { jurisdiction: form.jurisdiction }),
        contact: {
          ...(form.telegram.trim() && { telegram: form.telegram.trim() }),
          ...(form.twitter.trim() && { twitter: form.twitter.trim() }),
          ...(form.website.trim() && { website: form.website.trim() }),
        },
        publishedAt: new Date().toISOString(),
      };

      const message = buildPayload(profile);
      const signature = await signMessageAsync({ message });
      setPublishStatus('uploading');

      const res = await fetch('/api/reputation/profile/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, signature }),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(b.error ?? 'upload failed');
      }

      const { cid } = await res.json() as { cid: string };
      setPublishedCid(cid);
      setPublishStatus('done');
    } catch (err: unknown) {
      setPublishStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'something went wrong');
    }
  }

  function copyCid() {
    if (!publishedCid) return;
    navigator.clipboard.writeText(publishedCid).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
      {/* ── Form column ───────────────────────────────────────────── */}
      <div className="space-y-5">
        <Panel className="space-y-5 p-5">
          <PanelHeader title="Your profile" sub="Everything here is public. Only publish information you're comfortable sharing." />

          <div className="space-y-4 pt-1">
            <Field label="Display name" hint="How you appear on deal forms and the plug directory.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  placeholder="Kemi Adeyemi"
                  maxLength={60}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Bio"
              hint="One or two sentences. Max 280 characters."
              aside={<span className="text-xs text-faint">{form.bio.length}/280</span>}
            >
              {({ id, describedBy }) => (
                <TextArea
                  id={id}
                  aria-describedby={describedBy}
                  placeholder="I've been plugging deals in Lagos tech for 3 years…"
                  maxLength={280}
                  value={form.bio}
                  onChange={(e) => set('bio', e.target.value)}
                />
              )}
            </Field>

            <Field label="Specialties" hint="Deal categories you handle. Press Enter or tap Add.">
              {() => (
                <TagInput
                  value={form.specialty}
                  onChange={(v) => set('specialty', v)}
                  placeholder="e.g. Freelance dev, Design, Logistics"
                  max={5}
                />
              )}
            </Field>

            <Field label="Languages" hint="Languages you can communicate in.">
              {() => (
                <TagInput
                  value={form.languages}
                  onChange={(v) => set('languages', v)}
                  placeholder="e.g. en, yo, ha"
                  max={6}
                />
              )}
            </Field>

            <Field label="Country" hint="Two-letter country code, e.g. NG, GH, KE.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  placeholder="NG"
                  maxLength={2}
                  className="w-24 uppercase"
                  value={form.jurisdiction}
                  onChange={(e) => set('jurisdiction', e.target.value.toUpperCase().slice(0, 2))}
                />
              )}
            </Field>
          </div>
        </Panel>

        <Panel className="space-y-4 p-5">
          <PanelHeader title="Contact" sub="Optional. All are public." />
          <div className="space-y-3 pt-1">
            <Field label="Telegram">
              {({ id }) => (
                <Input id={id} placeholder="@yourhandle" value={form.telegram} onChange={(e) => set('telegram', e.target.value)} />
              )}
            </Field>
            <Field label="Twitter / X">
              {({ id }) => (
                <Input id={id} placeholder="@yourhandle" value={form.twitter} onChange={(e) => set('twitter', e.target.value)} />
              )}
            </Field>
            <Field label="Website">
              {({ id }) => (
                <Input id={id} type="url" placeholder="https://yoursite.com" value={form.website} onChange={(e) => set('website', e.target.value)} />
              )}
            </Field>
          </div>
        </Panel>

        {/* Publish */}
        <div className="space-y-3">
          {publishStatus === 'error' && (
            <Notice tone="danger">{errorMsg}</Notice>
          )}
          {publishStatus !== 'done' && (
            <Button
              size="lg"
              className="w-full"
              disabled={!hasContent}
              loading={publishStatus === 'signing' || publishStatus === 'uploading'}
              onClick={publish}
            >
              {publishStatus === 'signing'
                ? 'Check your wallet…'
                : publishStatus === 'uploading'
                  ? 'Uploading to IPFS…'
                  : 'Publish profile'}
            </Button>
          )}
          {publishStatus === 'done' && publishedCid && (
            <div className="space-y-3 rounded-[20px] border border-mint/40 bg-mint-soft p-5">
              <p className="font-medium text-mint-ink">Profile published.</p>
              <p className="text-sm text-muted">
                Your profile is live at{' '}
                <a href={`/plugs/${address}`} target="_blank" rel="noreferrer" className="underline">
                  /plugs/{address.slice(0, 8)}…
                </a>
                . Send this CID to the Plug360 team via Telegram so it gets linked to your listing.
              </p>
              <div className="flex items-center gap-2 rounded-[14px] bg-surface px-3.5 py-2.5">
                <code className="flex-1 overflow-x-auto text-xs text-ink">{publishedCid}</code>
                <button
                  type="button"
                  onClick={copyCid}
                  className="shrink-0 text-xs font-medium text-accent"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Preview column ────────────────────────────────────────── */}
      <div className="hidden lg:block lg:sticky lg:top-24">
        <LivePreview address={address} draft={draft} />
      </div>
    </div>
  );
}
