# Echo Protocol

Echo is a liquidity layer for human markets. It runs on Arc, Circle's stablecoin L1, and everything settles in USDC.

The idea in one line: in most hiring and competition flows, many people do real work and only the winner gets paid. Echo pays the people who showed up and did the work, not just the one who wins.

## The problem

When you post a job, run a contest, or shortlist candidates, you extract a lot of unpaid labor. Applicants write proposals, do take home tasks, and hand over ideas. The requester reads all of it, picks one, and everyone else gets nothing. Worse, a requester can collect every submission and then walk away without paying anyone. The cost of showing up sits entirely on the participant, and there is no lasting record that they did good work.

Echo changes the incentives:

- Money is escrowed up front, before anyone does work.
- Looking at someone's work is the act that pays them. You cannot harvest submissions for free.
- Reputation is written on chain whether you win or lose.
- If a requester advances you to the final round and then disappears, the protocol pays you anyway and marks the requester for it.

## How it works

Echo is thin orchestration on top of two open standards already live on Arc:

- ERC-8004 for identity and reputation (IdentityRegistry, ReputationRegistry, ValidationRegistry).
- ERC-8183 for on chain jobs (AgenticCommerce).

Every Echo market is a bundle of ERC-8183 jobs. When a job is created its hook points at `EchoHook`, and `EchoHook` holds all of Echo's logic: tiered payouts, ghost penalties, introducer rewards, and reputation writes. The money lives in Echo's own escrow, so payouts, fees, and refunds settle from one place the moment a job changes state.

Because it runs on Arc, gas is paid in USDC (about $0.006 per transaction) and confirmation is sub second. There is no separate gas token to hold.

Three contracts carry the weight:

- `MarketRegistry` creates markets, holds applications and tiers, and spawns the underlying jobs.
- `EchoHook` custodies escrow and settles every payout, penalty, and reputation write.
- `DisputeResolver` is the staked jury that settles contested, subjective verdicts.

## The three kinds of work

Echo supports three shapes of work. They share the same escrow, reputation, and dispute machinery.

### 1. Open Market: apply, reveal, shortlist

The signature flow. A requester opens a market and escrows a pool. Applicants apply. To read an applicant's full submission the requester pays a reveal fee, and that fee is paid out to the applicant in the same transaction. Looking is the payment, so harvesting work for free is structurally impossible.

From there the requester advances people through tiers, and each tier pays its own amount:

- Reveal or Substantive (the first paid look)
- Shortlist (a deeper round)
- Final (the real deliverable)

To keep applications honest, the requester can require a small returnable stake. It is held behind a flag window and refunded automatically if nothing is wrong. It is only forfeited if a revealed submission turns out to be a bait and switch, and that has to be proven through a dispute, never by a bare admin action.

Two guards protect participants:

- A reveal market cannot be closed and refunded until the requester has actually paid a minimum number of reveals (capped by how many people applied). Harvest then refund is blocked.
- If a requester advances someone to Final and then never accepts or rejects before the deadline, anyone can trigger the ghost penalty: the worker is paid the reserved Final amount and the requester takes a reputation hit. Silence does not let the requester keep the money or dodge the record.

### 2. Direct Job: two parties, milestones

When the requester and worker already chose each other, there is no pool or reveal. The requester escrows the full amount up front, split into milestones. The worker submits a milestone, and the requester accepts it to release that slice. If the requester goes quiet, anyone can release a submitted milestone once its review window passes, so a requester cannot accept delivered work and then sit on the payment. Cancelling a job only refunds milestones that were never submitted. Delivered work is never clawed back.

### 3. Bounty: open submissions, many winners

The requester escrows a reward pool and sets a floor award. Anyone who passes the entry filter can post a finding, one person can post many, and many findings can be paid in parallel. If the requester ignores a valid finding past its review window, anyone can escalate it to the floor so it cannot be quietly buried. A rejected finding can be taken to the staked jury.

## A worked example

Say a design studio wants a new brand identity and is willing to spend up to 2,000 USDC.

With a normal contest, fifty designers each spend a day on concepts, the studio picks one, pays that person, and the other forty nine get nothing. The studio could even take all fifty concept decks and hire someone offline.

With Echo as an Open Market, the studio escrows 2,000 USDC and sets tiers, for example 5 USDC to reveal a concept, 50 USDC for a shortlisted round, 250 USDC for the final deliverable.

1. Fifty designers apply.
2. The studio pays 5 USDC each time it opens a deck. That money lands with the designer instantly. The studio cannot read the work without paying for the look.
3. It shortlists eight designers into a 50 USDC round, then advances two finalists to a 250 USDC final.
4. One finalist delivers and is accepted, and is paid 250 USDC.
5. The other finalist also delivered, but the studio went silent. After the deadline the ghost penalty pays that finalist their 250 USDC and dings the studio's reputation.
6. Everyone who got opened earned money and an on chain record, even though only one person won the brief.

The same studio could instead run a Direct Job once it knows who it wants, escrowing the full fee in milestones, or a Bounty if it wanted many parallel submissions scored against a floor. Same money rails, same reputation, different shape.

## When things go wrong: disputes and recourse

Honest rejection is allowed and is free. A requester who genuinely does not want a final deliverable can reject it, the worker is not slashed, and the escrow refunds to the requester when the market closes.

But a worker who believes a Final rejection was unfair has recourse. They open a dispute and post a bond, the requester counters with a matching bond, and a jury settles it. If the jury sides with the worker, or the vote ties, the worker is paid the Final amount from escrow. If the jury sides with the requester, the rejection stands. The tie pays the worker on purpose: someone who did and delivered the work should not lose their pay when a panel cannot even reach a majority against them. While a dispute is open the market cannot be closed, so the requester cannot reclaim the contested money out from under it.

The jury is the third rung of an escalation ladder, and most disagreements never reach it. An off chain agent gives a non binding first pass against the acceptance criteria, deterministic checks settle anything provable, and only genuinely subjective disputes reach the staked jurors. In this version the juror panel is curated by the protocol operator. The vote engine is built so a stake based, decentralized court can replace that panel later without changing the market side.

## Reputation and attribution

Every payout writes reputation to ERC-8004. Workers build provider reputation for delivered work, and requesters build a responsiveness record that takes a hit when they ghost. Because reputation lives on a shared standard, it is portable beyond Echo.

Echo also rewards introductions. A requester can fund a pool that pays the person who introduced an applicant whenever that applicant advances a tier. Referrers earn for sending real talent, drawn from the requester's own funds, not from the worker's pay.

## Repository

```
echo-protocol/
  apps/
    web/        Next.js app: apply, hire, profiles, disputes, landing
    indexer/    Node and GraphQL indexer over the on chain events
  packages/
    contracts/  Solidity (Foundry): MarketRegistry, EchoHook, DisputeResolver, and friends
    sdk/        TypeScript SDK (viem) for builders and the web app
```

- Contracts are Solidity 0.8.26 on Foundry, deployed as UUPS upgradeable proxies on Arc.
- The web app uses Next.js, wagmi, and RainbowKit, with Circle modular wallets as an alternate sign in.
- The indexer reads contract events into a GraphQL API that powers browsing, activity, and reputation.

## Status

Live on Arc testnet. The full market lifecycle across all three job types, reputation, attribution, the ghost penalty, and the staked jury including worker recourse on a Final rejection are deployed and covered by the contract test suite.

## License

MIT. See `LICENSE`.
