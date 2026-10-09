# AI design

AI integration belongs behind `apps/api/src/modules/ai`; prompts, provider calls, and output validation stay server-side. The intended provider stack is LangChain with Groq. AI receives validated evidence and deterministic results and returns explanatory structured output; it does not set scores or rankings. No AI provider is connected by this scaffold. Do not place Groq keys in frontend configuration.
