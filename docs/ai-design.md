# AI design

AI analysis is an optional service behind `apps/api/src/modules/ai`. The current implementation uses Groq's OpenAI-compatible chat-completions API through native `fetch`; no LangChain dependency is used. Prompts, provider calls, and output validation stay server-side. The model receives bounded, minimized evidence and deterministic score summaries and returns schema-validated narrative findings with evidence references and limitations. It cannot set scores or rankings.

See [Day 5 AI analysis](day5-ai-analysis.md) for the active contract, configuration, safeguards, tests, and known limitations. Do not place Groq keys in frontend configuration. Provider calls are optional; unavailable configuration or provider errors preserve deterministic evaluation results.
