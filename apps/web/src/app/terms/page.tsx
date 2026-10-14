import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal/LegalPage';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The rules for using Plug360: how deals, plugs, fees and disputes work, and what we are and are not responsible for.',
};

const mail = <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated={SITE.legalUpdated}
      summary={
        <>
          <p>
            <strong>Plug360 is software, not a bank.</strong> Your USDC sits in a public smart contract, never with us.
          </p>
          <p>
            <strong>Your plug&apos;s ruling is final.</strong> Pick someone both of you know and trust.
          </p>
          <p>
            <strong>This is early software.</strong> The contract is unaudited and limited to 100 USDC per deal. Only use money you can afford to lose.
          </p>
        </>
      }
      sections={[
        {
          id: 'agreement',
          title: 'Agreeing to these terms',
          body: (
            <>
              <p>
                These terms apply when you use the Plug360 website at {SITE.domain} and the Plug360 escrow contract through it. By using Plug360 you agree to them. If you do not agree, do not use it.
              </p>
              <p>You must be at least 18 and allowed to make binding agreements where you live.</p>
            </>
          ),
        },
        {
          id: 'service',
          title: 'What Plug360 is',
          body: (
            <>
              <p>
                Plug360 helps two people who know each other pay for a job in USDC. The buyer pays into a smart contract on the Arc network. The money stays there until the buyer releases it, the money-back window ends, or the plug rules on a dispute.
              </p>
              <p>
                Plug360 never holds your funds or your keys. The contract&apos;s code decides where money can go, and it can only pay the seller, the plug&apos;s fee, or a refund to the buyer&apos;s address fixed at payment. We cannot reverse, freeze or redirect a payment.
              </p>
            </>
          ),
        },
        {
          id: 'wallets',
          title: 'Your wallet',
          body: (
            <>
              <p>
                You can use your own crypto wallet, or sign in with Google or email to get a wallet created by Circle. Circle wallets are also covered by Circle&apos;s terms. You are responsible for your wallet, your PIN and the device you sign in on.
              </p>
              <p>
                Check every address before you pay or sign. Blockchain payments are final, and Plug360 cannot recover money sent to a wrong address.
              </p>
            </>
          ),
        },
        {
          id: 'deals',
          title: 'Deals and plugs',
          body: (
            <>
              <ul>
                <li>The seller signs the terms first, then the plug accepts, then the buyer pays. Nothing moves until the buyer pays.</li>
                <li>The job description is part of what everyone signs. It cannot be changed after signing.</li>
                <li>The buyer can open a dispute before the money-back window ends. After it ends, the seller can be paid out.</li>
                <li>A plug has 7 days to rule on a dispute. If they miss that deadline, the buyer can be refunded in full, and anyone can trigger the refund.</li>
                <li>The plug&apos;s ruling is final. Plug360 does not review, overturn or take part in rulings.</li>
              </ul>
              <p>
                Plugs act on their own behalf, not for Plug360. A listed plug has been approved to referee deals up to a limit; listing is not a guarantee of their judgement.
              </p>
            </>
          ),
        },
        {
          id: 'fees',
          title: 'Fees',
          body: (
            <>
              <p>
                Plug360 charges no platform fee. Each deal may include a plug fee of up to 5% of the price, split evenly between buyer and seller. The plug earns the full fee when the seller is paid and half of it when the buyer is refunded.
              </p>
              <p>
                Arc network fees are paid in USDC. Plug360 or Circle may cover them for you in some cases, but we do not promise to.
              </p>
            </>
          ),
        },
        {
          id: 'rules',
          title: 'What you may not do',
          body: (
            <ul>
              <li>Use Plug360 for anything illegal where you or the other party live, including fraud, money laundering or sanctions evasion.</li>
              <li>Pay for goods or services that are illegal to sell.</li>
              <li>Pretend to be someone else, or create look-alike addresses to trick people.</li>
              <li>Attack, overload or try to break the website or the contract.</li>
            </ul>
          ),
        },
        {
          id: 'risks',
          title: 'Risks',
          body: (
            <>
              <p>Using Plug360 carries risks you accept, including:</p>
              <ul>
                <li>Bugs in the contract or website. The contract has not been audited.</li>
                <li>Problems with the Arc network, USDC, Circle or other services Plug360 depends on.</li>
                <li>A plug ruling against you, or a counterparty who does not deliver.</li>
                <li>Changes in the value of USDC or the law that applies to it.</li>
              </ul>
              <p>
                While the contract is new, it accepts at most 100 USDC per deal and holds at most 2,500 USDC in total. The test network version uses test USDC with no value.
              </p>
            </>
          ),
        },
        {
          id: 'liability',
          title: 'Our responsibility',
          body: (
            <>
              <p>
                Plug360 is provided as it is, without warranties of any kind. To the extent the law allows, we are not liable for lost funds, lost profits or any indirect loss arising from your use of Plug360, deals between users, or plug rulings.
              </p>
              <p>Nothing in these terms limits liability that cannot be limited by law.</p>
            </>
          ),
        },
        {
          id: 'changes',
          title: 'Changes and ending use',
          body: (
            <p>
              We may update these terms; the date at the top shows the latest version. We may stop offering the website at any time. Deals already funded can always be completed or refunded directly through the contract, even if the website is offline.
            </p>
          ),
        },
        {
          id: 'law',
          title: 'Law and contact',
          body: (
            <>
              <p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>
              <p>
                Questions go to {mail}. How we handle personal data is described in our <Link href="/privacy">privacy policy</Link>.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
