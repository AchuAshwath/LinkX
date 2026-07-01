# Spec: Brand Voice & Configuration

> **Status:** 🔲 Outline — needs discussion
> **Depends on:** [ai-stack](./ai-stack.md)
> **Depended on by:** [content-curation](./content-curation.md)

## Problem

A generic AI post sounds like a generic AI post. To be useful, the agent must write in the exact tone, style, and format of the specific Brand (formerly Persona). We need a way to configure and inject this "Brand Voice" into the AI prompts.

## Questions to Discuss

### Voice Configuration
- [ ] What dimensions of voice do we capture? (Tone, vocabulary, sentence length, emoji usage, hashtag style)
- [ ] Should the user describe the voice textually, or should we deduce it from provided "example posts"?
- [ ] Should we use a structured questionnaire for voice setup (e.g., "Are you formal or casual? 1-5 scale")?

### Content Guardrails
- [ ] What topics are explicitly allowed/encouraged?
- [ ] What topics or keywords are explicitly forbidden? (e.g., "never mention competitors X and Y")
- [ ] Do we need a "custom instructions" field (like ChatGPT custom instructions) per Brand?

### Prompt Engineering
- [ ] How is the Brand Voice injected into the LangChain system prompt?
- [ ] Do we use few-shot prompting with the provided example posts?

## Topics to Spec Out

1. Database schema updates for `Persona` (Brand) to store voice settings
2. System prompt templates for injecting brand context
3. UI components for configuring the brand voice
4. Few-shot example selection strategy
