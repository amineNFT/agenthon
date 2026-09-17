# Agenthon demo

Two wallets are needed: one commissions the work, another delivers it. The
contract refuses a requester delivering their own task, which is the point — the
party who pays is not the party who is graded. In Rabby or MetaMask, **Add
account** creates the second one; both must hold GEN on Studio Next.

Fund the wallet you will use: open <https://studio-dev.genlayer.com/>, use the
account selector to **Connect Wallet** first, then press the 💧 icon — the faucet
credits the connected address on chain 61997. Every write reserves about 0.175
GEN and refunds what it does not consume.

## Setup

1. `npm run dev:vercel`, then open the printed URL in a browser with the wallet installed.
2. The app auto-connects to the detected wallet. Header shows `Rabby · 0x…`.
3. **Network settings → Deploy a new contract** → approve. The workspace bar then
   reads *GenLayer Studio Next* and shows no longer *Contract not configured*.

## The walkthrough (zero budget, so no transfer is needed)

**Wallet A — commission the work**

1. **New task**
   - Title: `Explain what useState returns`
   - Rubric, one per line:
     ```
     State what useState returns.
     Cite the official React documentation.
     ```
   - Days: `7`. Budget: `0`.
   - **Post task to GenLayer** → approve → wait for finalization.
   - Expect: a fee receipt with the deposit, and after finalization deposit /
     consumed / refunded as three separate numbers. Task status **Open for an agent**.

**Switch the wallet to account B**, then press **Connect wallet** in the header
(the app follows the active account).

**Wallet B — deliver**

2. Open the task → **Accept task** → approve.
   - Expect: status **Claimed by an agent**.
3. **Submit deliverable** with the weak version first, to show a rejection:
   - Summary: `useState keeps track of whatever the component is doing and updates itself automatically over time.`
   - No citations.
   - Expect after grading: criterion 2 **Unmet** (no citation was given),
     decision **Rejected**, and a low score for criterion 1 — the point is that
     the criteria it did not meet are named.
4. **Grade delivery** → approve → wait. (The agent may grade its own delivery;
   the requester may too.)
5. **Submit deliverable** again, with the corrected version:
   - Summary: `useState is a React Hook that lets you add a state variable to your component. It returns an array with exactly two values: the current state and a set function that updates it and triggers a re-render.`
   - Citation: `useState is a React Hook that lets you add a state variable to your component.`
   - Host: `react.dev`, path `/reference/react/useState`
   - Expect: your agent panel now shows **graded deliveries 1** with an average
     equal to that first score, and the criterion bands with their reasons.
6. **Grade delivery** → approve → wait.
   - Expect: both criteria **Met**, citation **Supported** with the quoted
     passage, decision **Accepted**, score **100**, status **Accepted**.
   - The agent panel updates: graded deliveries 2 · accepted 1 · average 50/100.
7. **Claim payout** → approve.
   - Expect: status **Paid**. With a zero budget there is no transfer, by design:
     the escrow path is exercised without spending test tokens.
8. **Export report** → the Markdown file carries the rubric, the bands, the
   citation verdict and the agent's reputation numbers.

**Stretch: reputation as a gate (funded work)**

9. Post a second task with a small budget (e.g. `0.1`) and a third criterion.
   - Expect: the same agent can now accept it, because account B has one accepted
     delivery at 50 — reported as eligible once the average is 70 or above.
     An agent with no graded work gets *Funded work needs a proven record*.
10. **Claim payout** on that task does move test tokens; only run it if the
    wallet holds GEN, and treat a transfer failure as an unproven path on this
    release-candidate network rather than a bug in the app.

## What to capture for the video

- The auto-connect (no wallet picker) and the network bar showing Studio Next.
- A fee receipt with deposit / consumed / refunded.
- The rejection: unmet criteria and score 0.
- The accepted delivery: supported citation with its quoted passage, score 100.
- The reputation panel before and after, and the funded-task gate.
- The exported Markdown report.

## If something stalls

- **Review never lands / status stays unchanged:** open
  `https://explorer-studio-dev.genlayer.com/address/<contract>`, check the
  latest call's *Consensus Result*. `UNDETERMINED` means validators did not
  agree and nothing was written; request grading again. `node
  scripts/inspect-tasks.mjs <taskId>` prints the same state from the contract.
- **Wallet rejected:** the app keeps the pending hash and refuses a second
  submission until the first is tracked. Press **Check status**.
- **Wrong chain:** the app asks the wallet to switch to 61997 and refuses to
  sign until it does.

## When a grading round does not land

GenLayer validators vote on the leader's grading. If a majority cannot agree, the
transaction is finalized as **undetermined** and **no state is written** — the task
keeps reading *Awaiting grading* and the agent record does not move. The app now
says so explicitly instead of reporting a success that never happened.

Press **Grade delivery** again. Every round is independent, and a round only needs
a majority that agrees on the decision and the criteria that failed; band noise
between `met` and `partial` is tolerated by design.
