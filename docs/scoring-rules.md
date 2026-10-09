# Scoring rules

Official score and ranking calculation belongs only in `apps/api/src/modules/scoring` and must be deterministic. Contracts define an initial set of categories and a weight shape, but no scoring formula or final weights have been selected. Priya owns the implementation and boundary-case fixtures. The LLM must not change numeric results.
