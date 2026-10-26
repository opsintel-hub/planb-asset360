# Architecture rules

- Derive Claim Aging summary totals and department counts from the same fully filtered ticket collection used by the table and map, so all views remain consistent.
- Keep selected-asset risk visualizations presentation-only: reuse RiskDetail's risk, breakdown and advice for both views, preserving the persisted score and existing exports to avoid diverging calculations or extra requests.
- Implement the isometric risk anatomy with theme-token SVG surfaces and reduced-motion-aware CSS; the model illustrates risk inputs, never diagnosed physical equipment faults. Its charts consume RiskDetail's existing history events and normalized breakdown, never synthesized historical scores or additional requests.