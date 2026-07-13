# Ethics & Responsible Use

## Purpose

LinkX is a **research project** built to study and document the technical and legal boundaries of platform automation policies. It exists to answer a specific question:

> Where does a platform's jurisdiction over "automated access" end when an AI agent operates entirely outside the platform's technical boundary?

This project is not a tool for mass automation, spam, or circumventing platform rules at scale.

## What We're Doing

We are building two systems side by side and comparing them:

1. **System A** (browser automation): Deliberately operates *within* the platform's technical boundary to serve as a **control case**. It proves that current ToS clauses effectively catch direct automation regardless of evasion sophistication.

2. **System B** (screen observation, in planning): Designed to operate *outside* the platform's technical boundary to demonstrate that a **jurisdictional gap** exists in current ToS frameworks.

The research value comes from the comparison, not from the automation itself.

## What We're NOT Doing

- **Not encouraging ToS violations.** System A exists to prove that ToS *does* catch browser automation — that's a finding in favor of platform enforcement.
- **Not building a spam tool.** LinkX is a personal scheduler for your own accounts with your own content.
- **Not claiming legal protection.** Operating in a "gray area" doesn't mean something is legal. We document the gray area; we don't claim it's safe to operate in.
- **Not attempting to deceive platforms.** The evasion techniques in System A are documented openly and analyzed for their forensic footprint.

## Legal Context

Our analysis draws on existing case law and policy frameworks:

- **hiQ Labs v. LinkedIn (9th Circuit, 2022)**: Scraping publicly visible data does not violate the Computer Fraud and Abuse Act. While this case concerned web scraping, the underlying principle — that observing data you're authorized to view occupies different legal ground than unauthorized access — informs our analysis of System B.
- **CFAA boundaries**: Violating a platform's ToS is generally a *breach of contract*, not a federal crime under the CFAA. The primary risk is account suspension, not criminal liability.
- **Accessibility law (ADA)**: Platforms cannot aggressively block input originating from OS accessibility frameworks without risking violations of digital accessibility law. This creates a technical constraint on how platforms can detect and block certain types of automated input.

We are not lawyers. This is a technical analysis, not legal advice.

## Analogy: Security Research

This project is analogous to penetration testing or security vulnerability research. The goal is to:

1. Identify a gap in a defensive system (platform ToS)
2. Document it openly
3. Demonstrate it with a working proof of concept
4. Provide findings that help the defensive system improve

Responsible security researchers publish vulnerabilities so they get fixed. We're documenting a policy gap so platforms can make informed decisions about their governance models.

## Guidelines for Contributors

- Don't use this project to automate accounts you don't own
- Don't use this project at scale to manipulate engagement or trends
- Don't target other users (scraping DMs, automating follows/unfollows, etc.)
- Do document your findings openly
- Do treat account safety seriously — the evasion documentation exists to explain *how* detection works, not to help you dodge it
