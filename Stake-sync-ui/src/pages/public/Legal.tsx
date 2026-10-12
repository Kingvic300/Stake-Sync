import { Link } from 'react-router'
import { LegalPage, type LegalSection } from '../../components/LegalPage'

// Drafts written for Stake-Sync's product model. They must be reviewed by counsel before launch.
const UPDATED = 'October 11, 2026'

const terms: LegalSection[] = [
  {
    id: 'about',
    title: 'About these terms',
    body: (
      <>
        <p>
          These Terms and Conditions (“Terms”) are an agreement between you and Stake-Sync (“Stake-Sync”, “we”, “us”). They
          cover your use of the Stake-Sync website, apps and related services (the “Service”).
        </p>
        <p>
          By creating an account or using the Service you agree to these Terms and to our{' '}
          <Link to="/privacy">Privacy Policy</Link>. If you don’t agree, don’t use the Service.
        </p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: 'Who can use Stake-Sync',
    body: (
      <>
        <p>You can use the Service if you:</p>
        <ul>
          <li>are at least 18 years old, or the age of majority where you live if that is higher;</li>
          <li>can form a binding contract under the laws that apply to you;</li>
          <li>are not barred from using services like this one, including under sanctions laws; and</li>
          <li>live somewhere staked challenges are permitted. Some features may be unavailable in some countries.</li>
        </ul>
        <p>Organizations may let their members use no-stake challenges under the organization’s own terms.</p>
      </>
    ),
  },
  {
    id: 'accounts',
    title: 'Your account',
    body: (
      <>
        <p>
          Keep your login details secure and tell us straight away if you think someone else has accessed your account.
          You are responsible for activity on your account.
        </p>
        <p>
          You may hold <strong>one</strong> Stake-Sync account. Each GitHub, LeetCode, Codeforces, WakaTime or other connected account,
          and each wallet, can be linked to only one Stake-Sync account. Creating extra accounts to join a challenge more
          than once or to collect extra rewards is not allowed.
        </p>
        <p>
          Some challenges require stronger verification, such as a verified phone number or an identity check by one of
          our partners. If you can’t complete it, you may not be able to join those challenges.
        </p>
      </>
    ),
  },
  {
    id: 'challenges',
    title: 'Challenges and their rules',
    body: (
      <>
        <p>
          Each challenge shows its full rules before you join: the requirement, dates, stake, strikes, penalties, freezes,
          how it’s verified, how rewards are split, how disputes work and who can join.
        </p>
        <p>
          You must accept a challenge’s rules before you join it. Those rules form part of your agreement with us for that
          challenge. Once participants have committed, the creator can’t materially change the rules unless the
          participants consent in the way the Service provides.
        </p>
        <p>
          Challenge creators, including organizations, are responsible for describing their challenges accurately. They can
          only choose penalty structures we have approved.
        </p>
      </>
    ),
  },
  {
    id: 'stakes',
    title: 'Stakes and escrow',
    body: (
      <>
        <p>
          A stake is commitment collateral in USDC that you choose to put into a challenge. When you join a staked
          challenge, your stake moves from your balance into an escrow account controlled by the Stake-Sync program on the
          Solana blockchain.
        </p>
        <ul>
          <li>We do not take custody of escrowed stakes, and our staff have no ability to withdraw them.</li>
          <li>The program releases stakes only according to the rules that applied when the challenge began.</li>
          <li>A stake is not a deposit, investment, savings product or wager on an outcome you don’t control.</li>
          <li>Your stake is returned if you complete the challenge, less any penalties the rules allow.</li>
        </ul>
        <p>
          Transactions on Solana are generally final and irreversible. Make sure you understand a challenge’s rules before
          you stake.
        </p>
      </>
    ),
  },
  {
    id: 'verification',
    title: 'Verification',
    body: (
      <>
        <p>
          We check your progress using the services you connect, such as GitHub, LeetCode, Codeforces, WakaTime and Solana. Each challenge
          states what counts and what doesn’t.
        </p>
        <p>
          <strong>A technical failure is never treated as your failure.</strong> If a verification provider is unavailable,
          the result is recorded as “provider down” and does not count against you. We retry, and if the provider never
          recovers, the result is settled through a dispute.
        </p>
        <p>
          You must not fake, copy, automate or otherwise manipulate the activity used to verify a challenge. See{' '}
          <a href="#conduct">Prohibited conduct</a>.
        </p>
      </>
    ),
  },
  {
    id: 'strikes',
    title: 'Strikes, penalties and forfeits',
    body: (
      <>
        <p>
          Most challenges give you free strikes. A missed requirement uses a strike and costs nothing. Only after your free
          strikes are used can a penalty apply, and only as the challenge rules state.
        </p>
        <p>
          Amounts lost under a challenge’s rules are “forfeited”. Where the law allows, forfeits may be shared among the
          participants who complete the challenge. Where it doesn’t, forfeits are handled as the challenge rules describe.
        </p>
        <p>
          Some challenges allow one emergency freeze, which pauses your requirements for a set number of days. A freeze
          can’t be used after a requirement has already been missed.
        </p>
      </>
    ),
  },
  {
    id: 'rewards',
    title: 'Rewards and claims',
    body: (
      <>
        <p>
          Rewards may come from sponsors, organizations, Stake-Sync or, where permitted, forfeited stakes. Any reward
          estimate shown before a challenge ends is only an estimate; the final amount is set when the challenge settles.
        </p>
        <p>
          After settlement, the amount you can withdraw is shown as “Ready to claim”. You are responsible for any taxes
          that apply to rewards you receive.
        </p>
      </>
    ),
  },
  {
    id: 'disputes',
    title: 'Disputes about results',
    body: (
      <>
        <p>
          If you think a verification result is wrong, you can open a dispute from the Disputes page within 48 hours of the
          result. Money affected by a disputed result stays locked until the dispute is resolved.
        </p>
        <p>
          A moderator reviews the verification data and the provider’s information, and may ask you for more evidence. They
          will either approve the result as complete or confirm the failure. Moderators can’t move escrowed funds; they can
          only record the outcome the program then acts on.
        </p>
      </>
    ),
  },
  {
    id: 'payments',
    title: 'Adding and withdrawing money',
    body: (
      <>
        <p>You can add money in two ways:</p>
        <ul>
          <li>
            <strong>Local currency.</strong> Payments by bank transfer or card go through our payment partner
            (currently LocalRamp), which converts them to USDC. Their terms also apply, and they may
            ask you to verify your identity.
          </li>
          <li>
            <strong>Your own Solana wallet.</strong> You approve each transaction in your wallet. You are responsible for
            keeping your wallet and recovery phrase secure; we can’t recover them for you.
          </li>
        </ul>
        <p>
          <strong>Converting costs money.</strong> Our partner sets the exchange rate and charges a fee each way (when you add money and again when you cash out to your bank). The exact rate, fee and the amount
          you’ll receive are shown before you pay. Stake-Sync doesn’t set or receive these fees. Rates move, so converting
          back later can give you more or less local currency than you paid.
        </p>
        <p>
          Stake-Sync pays the Solana network fees for actions in the app. Withdrawals go to your bank through our partners or
          to a wallet you choose, and may take time to arrive.
        </p>
      </>
    ),
  },
  {
    id: 'fees',
    title: 'Fees',
    body: (
      <>
        <p>Stake-Sync charges two fees on challenges with stakes. Both are shown before you join and are part of the rules you accept:</p>
        <ul>
          <li>
            <strong>Joining fee:</strong> 2% on top of your stake. A 20 USDC stake costs 20.40 USDC. It’s held in escrow with
            your stake and refunded in full if the challenge is cancelled.
          </li>
          <li>
            <strong>Share of forfeits:</strong> of the stakes and penalties forfeited by people who miss days, Stake-Sync keeps
            60% and everyone who finishes shares the other 40% equally. If nobody finishes, the forfeits go to Stake-Sync.
          </li>
        </ul>
        <p>
          We never take a fee from your own stake when you finish (only the penalties in the challenge rules apply), and
          sponsor prize money always goes in full to the people who finish. Because part of our revenue comes from forfeits,
          we earn more when people don’t finish; that’s why the rules, the strike limits and every result are fixed and
          checkable before and after you join. Fees for a challenge never change once it has started. Payment partner fees
          for converting currency are separate (see “Adding and withdrawing money”).
        </p>
      </>
    ),
  },
  {
    id: 'conduct',
    title: 'Prohibited conduct',
    body: (
      <>
        <p>You must not:</p>
        <ul>
          <li>create or use more than one account, or join a challenge through someone else’s account;</li>
          <li>submit fake, copied, automated or meaningless activity, such as empty commits, to pass verification;</li>
          <li>coordinate with others to farm rewards or manipulate leaderboards;</li>
          <li>use the Service for money laundering, fraud or anything unlawful;</li>
          <li>harass, threaten or spam other people in chats; or</li>
          <li>interfere with the Service, its security or the Stake-Sync program.</li>
        </ul>
        <p>
          If we reasonably believe you have broken these rules, we may remove you from challenges, flag results for review,
          or suspend your account. Any effect on your funds is decided through the dispute and settlement process and the
          challenge rules.
        </p>
      </>
    ),
  },
  {
    id: 'organizations',
    title: 'Organizations',
    body: (
      <p>
        Organizations that run challenges or sponsor rewards agree to these Terms and to any separate organization agreement.
        Organizations are responsible for their challenges, announcements and how they moderate their communities. Sponsor
        funds are held in escrow and paid out according to the challenge’s distribution rules.
      </p>
    ),
  },
  {
    id: 'risks',
    title: 'Risks you should understand',
    body: (
      <ul>
        <li>Blockchain transactions are irreversible, and networks can be congested or unavailable.</li>
        <li>Smart contracts can contain bugs, even after audits.</li>
        <li>
          <strong>Your balance is in USDC, which follows the US dollar.</strong> It isn’t affected by your local currency’s
          inflation, but it is affected by US dollar inflation, and its value in your local currency rises and falls with the
          exchange rate.
        </li>
        <li>
          <strong>USDC is issued by Circle, a private company,</strong> and is meant to be backed one-to-one by US dollars. It
          is not legal tender, not a bank deposit and not covered by deposit insurance. Its price has briefly fallen below one
          dollar before (in March 2023, during a US bank failure), and Circle can freeze USDC held at a specific address when
          required by law.
        </li>
        <li>Verification providers may change or remove the data we rely on.</li>
        <li>Laws about digital assets are changing and may affect which features are available to you.</li>
      </ul>
    ),
  },
  {
    id: 'ending',
    title: 'Ending your account',
    body: (
      <p>
        You can close your account at any time once you have no active challenges and nothing waiting to be claimed. We may
        suspend or close accounts that break these Terms. Closing an account doesn’t affect challenges that have already
        settled.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Disclaimers and liability',
    body: (
      <>
        <p>
          The Service is provided “as is”. To the extent the law allows, we don’t guarantee that it will always be available
          or error-free.
        </p>
        <p>
          To the extent the law allows, we aren’t liable for indirect or consequential losses, or for losses caused by
          third-party services, blockchain networks or your own wallet. Nothing in these Terms limits liability that can’t
          be limited by law, including for fraud.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these Terms. If a change materially affects you, we’ll tell you in advance. Changes never alter the
        rules of a challenge you have already joined.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: (
      <p>
        These Terms are governed by the laws of <strong>[jurisdiction to be confirmed]</strong>. Courts in that jurisdiction
        have jurisdiction over disputes about these Terms, unless the law where you live gives you the right to bring
        proceedings there.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these Terms: <a href="mailto:stakesync2@gmail.com">stakesync2@gmail.com</a>.
      </p>
    ),
  },
]

const privacy: LegalSection[] = [
  {
    id: 'scope',
    title: 'What this policy covers',
    body: (
      <p>
        This Privacy Policy explains what personal data Stake-Sync collects when you use our website and apps, why we
        collect it, who we share it with and the choices you have. It applies alongside our{' '}
        <Link to="/terms">Terms and Conditions</Link>.
      </p>
    ),
  },
  {
    id: 'collect',
    title: 'Information we collect',
    body: (
      <>
        <p>
          <strong>Information you give us:</strong> your name, username, email address, password (stored only as a secure
          hash), profile details, interests, messages you post in challenge chats, and evidence you submit in disputes.
        </p>
        <p>
          <strong>Connected accounts:</strong> when you connect GitHub, LeetCode, Codeforces, WakaTime or another provider, we receive
          read-only access to the activity needed for verification, such as commits, accepted submissions or workout
          summaries. We never post to these accounts.
        </p>
        <p>
          <strong>Wallet information:</strong> your public wallet address and on-chain activity related to Stake-Sync. We
          never ask for, see or store your recovery phrase or private keys.
        </p>
        <p>
          <strong>Payment information:</strong> when you add money in local currency, our payment partners collect the
          payment and identity details they need. We receive confirmation of the payment and its status, not your full card
          or bank details.
        </p>
        <p>
          <strong>Usage and device information:</strong> pages and features you use, approximate location from your IP
          address, device and browser type, and diagnostic logs.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <ul>
        <li>to run your account and the challenges you join;</li>
        <li>to verify your progress and calculate strikes, penalties and rewards;</li>
        <li>to process payments, claims and withdrawals with our partners;</li>
        <li>to detect and prevent fraud, multiple accounts and reward farming;</li>
        <li>to resolve disputes and moderate communities;</li>
        <li>to send notifications you’ve chosen, such as deadline reminders; and</li>
        <li>to improve the Service and keep it secure.</li>
      </ul>
    ),
  },
  {
    id: 'basis',
    title: 'Our legal bases',
    body: (
      <p>
        Where data protection laws such as the Nigeria Data Protection Act or the GDPR apply, we rely on: performing our
        contract with you; our legitimate interests in running a fair and secure service; complying with legal obligations,
        such as anti-money-laundering checks; and your consent, for things like optional emails, which you can withdraw at
        any time.
      </p>
    ),
  },
  {
    id: 'public',
    title: 'What other people can see',
    body: (
      <>
        <p>
          Your username, avatar, commitment score and achievements are visible on your profile. Other participants in a
          challenge can see your progress on its leaderboard and your messages in its chat. You can make your profile
          private, hide active challenges, hide amounts staked and appear anonymously on leaderboards in your settings.
        </p>
        <p>
          <strong>Blockchain data is public and permanent.</strong> Transactions involving your wallet and the Stake-Sync
          program are recorded on Solana, where anyone can see them and nobody, including us, can delete them.
        </p>
      </>
    ),
  },
  {
    id: 'share',
    title: 'Who we share it with',
    body: (
      <>
        <ul>
          <li>
            <strong>Payment partners</strong> (currently LocalRamp) that convert local currency and process withdrawals, and may verify identity.
          </li>
          <li>
            <strong>Verification providers</strong> you connect, to the extent needed to read your activity.
          </li>
          <li>
            <strong>Organizations</strong> whose challenges you join, which can see your progress in those challenges and
            export results.
          </li>
          <li>
            <strong>Service providers</strong> that host our systems, send email and help us detect fraud, under contracts
            that limit how they use your data.
          </li>
          <li>
            <strong>Authorities</strong>, when the law requires it or to protect people from harm.
          </li>
        </ul>
        <p>We don’t sell your personal data.</p>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <p>
        We keep your data while your account is open. After you close it, we delete or anonymize it within a reasonable
        period, except where we must keep records longer for legal, tax, anti-fraud or dispute reasons. On-chain records
        can’t be deleted.
      </p>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights and choices',
    body: (
      <>
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>access the personal data we hold about you;</li>
          <li>correct inaccurate data;</li>
          <li>delete your data, subject to legal limits;</li>
          <li>object to or restrict some processing;</li>
          <li>receive your data in a portable format; and</li>
          <li>withdraw consent and complain to your data protection authority.</li>
        </ul>
        <p>
          You can disconnect a provider at any time in your profile. To exercise these rights, email{' '}
          <a href="mailto:stakesync2@gmail.com">stakesync2@gmail.com</a>.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        We encrypt sensitive data, protect access tokens for connected accounts, validate webhook signatures and monitor for
        abuse. No system is perfectly secure, so please use a strong password and keep your wallet secure.
      </p>
    ),
  },
  {
    id: 'storage',
    title: 'Cookies and local storage',
    body: (
      <p>
        We use essential cookies and browser storage to keep you logged in and remember your preferences. If we add
        analytics or marketing cookies, we will ask first where the law requires it.
      </p>
    ),
  },
  {
    id: 'transfers',
    title: 'International transfers',
    body: (
      <p>
        Our providers may process data outside your country. When they do, we use safeguards required by applicable law,
        such as contractual protections.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>Stake-Sync is not for anyone under 18, and we don’t knowingly collect their data.</p>,
  },
  {
    id: 'updates',
    title: 'Changes to this policy',
    body: <p>We’ll update this page when our practices change and tell you directly about significant changes.</p>,
  },
  {
    id: 'privacy-contact',
    title: 'Contact',
    body: (
      <p>
        Privacy questions or requests: <a href="mailto:stakesync2@gmail.com">stakesync2@gmail.com</a>.
      </p>
    ),
  },
]

export function Terms() {
  return (
    <LegalPage
      title="Terms and Conditions"
      updated={UPDATED}
      other={{ to: '/privacy', label: 'Privacy Policy' }}
      sections={terms}
      summary={
        <p>
          The short version: you keep control of your money, stakes sit in escrow under rules you accept up front, a
          provider outage never counts against you, and one person gets one account. The full terms are below.
        </p>
      }
    />
  )
}

export function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated={UPDATED}
      other={{ to: '/terms', label: 'Terms and Conditions' }}
      sections={privacy}
      summary={
        <p>
          The short version: we read only the activity needed to verify your challenges, we never see your wallet’s private
          keys, we don’t sell your data, and you control what’s public. On-chain transactions are public by nature.
        </p>
      }
    />
  )
}
