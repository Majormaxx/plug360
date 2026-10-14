import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal/LegalPage';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Plug360 collects, why, who else sees it, and how to reach us.',
};

const mail = <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={SITE.legalUpdated}
      summary={
        <>
          <p>
            <strong>We keep almost nothing.</strong> Plug360 has no accounts database, no analytics and no advertising trackers.
          </p>
          <p>
            <strong>Deals live on a public blockchain.</strong> Wallet addresses, amounts and deal status are visible to anyone, forever.
          </p>
          <p>
            <strong>Google and email sign-in is run by Circle.</strong> Circle sees your email address and creates your wallet. We never see your Google password or your PIN.
          </p>
        </>
      }
      sections={[
        {
          id: 'who',
          title: 'Who we are',
          body: (
            <>
              <p>
                Plug360 is an app at {SITE.domain} for paying for small jobs in USDC. The money waits in a smart contract on the Arc network until the job is done, and a person both sides trust (the plug) settles any dispute.
              </p>
              <p>Questions about this policy or your data go to {mail}.</p>
            </>
          ),
        },
        {
          id: 'collect',
          title: 'What we collect',
          body: (
            <>
              <p>
                <strong>When you sign in with Google or email.</strong> Circle, our wallet provider, receives your email address (and, for Google, your name and profile picture as Google shares them) so it can create and secure your wallet. Our server passes requests to Circle but does not store your email or profile.
              </p>
              <p>
                <strong>When you use a deal.</strong> Each deal is recorded on the Arc blockchain: the buyer, seller and plug wallet addresses, the price, the plug fee, the deadlines, a fingerprint (hash) of the job description, and every payment, dispute and payout. We do not run this record and cannot change or delete it.
              </p>
              <p>
                <strong>The job description itself</strong> travels inside the deal link, after the <code className="font-mono text-[13px] text-ink">#</code>. Browsers never send that part of a link to a server, so it reaches only the people you share the link with.
              </p>
              <p>
                <strong>Technical data.</strong> Our hosting provider receives your IP address and browser details with every request, as any website does. We use your IP address for a few minutes at a time to limit how often sign-in and gas requests can be made. We do not keep it.
              </p>
            </>
          ),
        },
        {
          id: 'device',
          title: 'What stays on your device',
          body: (
            <>
              <p>Plug360 keeps a few things in your browser so the app works the next time you open it. None of it is sent to us.</p>
              <ul>
                <li>Your light or dark theme choice.</li>
                <li>Titles of deals you opened and plugs you picked, so they show up as suggestions.</li>
                <li>A cache of deals your wallet is part of, so My deals loads quickly.</li>
                <li>Your Circle sign-in for the current tab. Closing the tab signs you out.</li>
              </ul>
              <p>We do not use cookies for tracking. Clearing your browser&apos;s site data removes all of the above.</p>
            </>
          ),
        },
        {
          id: 'sharing',
          title: 'Who else is involved',
          body: (
            <>
              <ul>
                <li>
                  <strong>Circle</strong> provides sign-in and user wallets, and pays network fees for new wallets. Its own privacy policy covers what it does with your email and wallet data.
                </li>
                <li>
                  <strong>Google</strong> handles the sign-in screen when you choose Google.
                </li>
                <li>
                  <strong>Vercel</strong> hosts the website.
                </li>
                <li>
                  <strong>Arc network nodes</strong> (RPC providers) receive the blockchain reads and transactions your browser sends.
                </li>
                <li>
                  <strong>Your plug and the other side of the deal</strong> see the deal terms, the job description from the link, and your wallet address.
                </li>
              </ul>
              <p>We do not sell personal data, and we do not share it for advertising.</p>
            </>
          ),
        },
        {
          id: 'rights',
          title: 'Your choices and rights',
          body: (
            <>
              <p>
                You can ask us what personal data we hold about you, or ask us to correct or delete it, by writing to {mail}. In practice we hold almost none. For your Circle account, we can pass a deletion request to Circle on your behalf.
              </p>
              <p>
                Records on the blockchain cannot be deleted by anyone, including us. If you do not want a wallet address linked to you publicly, use a fresh wallet for your deals.
              </p>
              <p>
                If you live in Nigeria, the Nigeria Data Protection Act 2023 gives you these rights and the right to complain to the Nigeria Data Protection Commission. People elsewhere may have similar rights under their own laws.
              </p>
            </>
          ),
        },
        {
          id: 'security',
          title: 'Security',
          body: (
            <p>
              Plug360 never holds your keys or your money. Payments go straight from your wallet to the escrow contract, and the contract can only pay the addresses fixed when the deal was funded. How the contract protects funds is described in our{' '}
              <a href={SITE.security} target="_blank" rel="noreferrer">
                security notes
              </a>
              .
            </p>
          ),
        },
        {
          id: 'children',
          title: 'Children',
          body: <p>Plug360 is not meant for anyone under 18, and we do not knowingly collect data from children.</p>,
        },
        {
          id: 'changes',
          title: 'Changes to this policy',
          body: (
            <p>
              If we change how we handle data, we will update this page and the date at the top. For anything significant, we will also say so on the home page. Using Plug360 is also covered by our <Link href="/terms">terms</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
