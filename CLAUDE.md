# Working on Depo-Pro

## The priority

**Get the application to the point where the reporter can actually use it.**

That is the goal every suggestion is measured against. This project already has
far more evidentiary machinery than it has ways to operate that machinery, and
the gap that matters is usability, not depth.

## Before recommending anything

Ask: *does the reporter need this to do their work?*

- **Yes** — propose it, scoped as small as it can usefully be.
- **No** — don't raise it unprompted. If it is a genuine risk to correctness or
  evidence, say so in one or two sentences and move on. Do not turn it into a
  work item unless asked.

A thing being technically interesting, architecturally tidier, or the sort of
improvement a reviewer would praise is not a reason to build it here.

## Bias toward the smaller version

When there is a large correct answer and a small sufficient one, offer the small
one first and say what it does not cover. Complexity added now is complexity the
owner maintains alone, on a Windows machine, while also doing depositions.

Prefer:

- Wiring an existing capability to a screen over building new capability
- One screen that completes a task over three that each do part of one
- Fixing something that is wrong over adding something that is missing
- Leaving a known gap documented over filling it speculatively

## Do not

- Propose refactors, abstractions, or infrastructure that no current task needs
- Add configuration, options, or modes nobody asked for
- Expand a request's scope because an adjacent problem became visible while
  working — mention it, finish what was asked
- Present a list of possible next steps as though each one were pending work

## Still true, and not in tension with the above

Correctness in the evidentiary path is not optional, and neither is honesty
about it. Measure before claiming. Say what is unmeasured. A guard that protects
audio integrity, transcript provenance, or a certified record earns its
complexity — those are the parts a court could be asked to rely on.

The distinction is between *rigour where the evidence lives* and *elaboration
everywhere else*. The first is the point of the application. The second is what
makes it too hard to use.

## When in doubt

Ask which of two smaller options is wanted, rather than proposing the larger one
that covers both.
