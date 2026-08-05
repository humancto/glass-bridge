# GlassBridge governance

GlassBridge is currently a maintainer-led research project. This lightweight
model keeps decisions explicit while the protocol and contributor community are
still forming.

## Roles

- **Maintainer:** owns repository administration, releases, security response,
  roadmap decisions, and final merge authority.
- **Contributor:** proposes code, documentation, test data, research results, or
  protocol changes through GitHub issues and pull requests.
- **Reviewer:** provides technical review in an area of demonstrated expertise.
  Review does not by itself grant merge or release authority.

The current maintainer is [@humancto](https://github.com/humancto).

## Decision process

Small compatible changes use normal pull-request review. A change that alters
AGX semantics, wire formats, cryptographic profiles, trust policy, receipt
meaning, or public security claims must include:

1. the user or research outcome;
2. compatibility and migration consequences;
3. threat-model and resource-bound analysis;
4. positive and negative test vectors; and
5. an explicit distinction between implemented behavior and hypothesis.

The maintainer records the decision in the pull request. Substantial or
incompatible protocol proposals should begin as an issue or design document so
alternatives can be considered before implementation.

## Releases and claims

A release is cut only from the protected default branch after required checks
pass. Release notes must identify experimental interfaces and avoid converting
nominal channel budgets into physical-goodput claims. Security and air-gap
language follows the limitations in [SECURITY.md](SECURITY.md).

## Changes to governance

Governance changes use the same public pull-request process. Before adding a
second maintainer, the project should document nomination, removal, quorum,
conflict-of-interest, security-response, and appeal procedures.
