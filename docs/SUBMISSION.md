# Agent Tank application draft

## Project name

Agenthon

## Short description

Agenthon grades agent work against a rubric through GenLayer validators, pays the
agent out of escrow on an accepted delivery, and records the score as portable
on-chain reputation that other tasks can require.

## Problem

Anyone commissioning work from an agent faces the same problem: the deliverable
is a wall of fluent text, the citations may not support it, and the only judge
available is the party who pays — or the party who wants to be paid. Rating
systems solve this by asking users to trust one platform's score, which that
platform can inflate, reset or sell. There is no way to carry a good record from
one marketplace to another, and no way to make a grade stick once the platform
loses interest.

## Product

A requester posts a task with 1–4 rubric criteria, a deadline and an optional GEN
budget. An agent accepts it, and delivers a summary with up to three citations to
official documentation. Grading retrieves every cited page, checks each citation
against its source, and bands each rubric criterion as met, partial or unmet; the
decision and a 0–100 score follow deterministically from those bands. An accepted
delivery releases the escrow to the agent and indexes the score into the agent's
public record: graded deliveries, accepted count and average score, readable by
any contract that asks for that address.

## Why GenLayer

The contested question is whether a delivered piece of work satisfies a rubric
and whether its citations support its claims. Neither side of the trade can be
the judge: the requester has an incentive to mark work down and keep the budget,
the agent has an incentive to overstate what it delivered. A centralized model
would replace that with one operator judging every agent in the ecosystem, which
is precisely what a portable reputation must not depend on. Ordinary
deterministic checks can confirm that a URL resolves or that a passage exists,
but not whether the passage supports the claim, nor how much of a criterion the
delivery actually met. GenLayer validators independently retrieve the sources and
grade the delivery, then apply a custom Equivalence Principle to their own
result: the decision and the failed criteria must match the leader's exactly,
because those decide payment and the agent's record, while wording-level band
differences are tolerated.

## Demonstration

The walkthrough posts a task with two criteria — "state what useState returns"
and "cite the official React documentation" — and an uncited, hand-waving
delivery, which is graded `rejected` with an unmet criterion and no payout. The
agent then delivers a summary that matches the React reference and cites
`https://react.dev/reference/react/useState`; the validators fetch that page,
confirm the quoted passage, band both criteria `met`, and the task is `accepted`.
The payout becomes claimable, and the same wallet's reputation panel shows the
delivery indexed: graded count, average score and the trusted flag.

## Implementation

React and TypeScript workbench; Python Intelligent Contract; GenLayer JS wallet
integration with a Transaction Kit fee path; native test-token escrow; independent
source retrieval and rubric grading by each validator; deterministic band-to-score
mapping; portable per-address reputation with gating; Markdown report export;
contract and application tests. There is no centralized verdict API and no
off-chain score server.

## Deployment

Network: **Studio Next** — the environment the hackathon requires. It is the
consensus v0.6 preview, chain **61997**, canonical RPC
`https://studio-dev.genlayer.com/api` (the announcement's
`studio-next.genlayer.com/api` is the same environment). The app, the contract
runner and the test toolchain are pinned to the v0.6 release-candidate family.

Contract: see `lib/deployment.json`. The app is pinned to that one address: it
has no network picker and never deploys, so opening it is enough to use it.

### Deploying again

1. `node scripts/deploy-studio.mjs` — signs with the test account under the
   git-ignored `.keys/`, which needs a little GEN for the fee deposit, and writes
   the new address back into `lib/deployment.json`.
2. Or deploy `contracts/agenthon.py` from the Studio Next UI with your own wallet,
   keeping the runner pin on the first line, then put that address in
   `lib/deployment.json`.

Either way the front end reads the address at build time, so rebuild and push
after changing it.

## Current limits

The source allowlist covers official developer documentation, so this version is
aimed at engineering work. A rubric can be ambiguous, and a vague criterion will
be graded vaguely — the contract bounds what graders may return, not how well a
rubric is written. A cited page can itself be wrong. The contract is unaudited.
Studio Next is a release-candidate environment that may reset, and its fee
accounting can change without notice. Transfer behaviour on that network is not
proven by the contract tests, which run in direct mode; the demo therefore runs
with a zero budget, where no transfer is required.

## Submission checklist

- [ ] Deploy the contract on Studio Next and set the address in `lib/deployment.json`.
- [ ] Run the demo end to end on the deployed contract and record it.
- [ ] Confirm the public repository opens without signing in.
- [ ] Keep the repository on the release-candidate dependency family (`npm ci` must resolve).
- [ ] Recheck account-only fields and terms in the portal.
- [ ] Submit before the deadline and retain the portal confirmation.
