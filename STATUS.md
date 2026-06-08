# Rations Status

## Current MVP

Local-first PWA for logging meals, estimating calories/macros from a photo or text, tracking daily goals, reviewing history, and optionally syncing encrypted data by phrase.

## Active Task

Complete: add persistent food memory so saved user foods, brands, portions, and macros are included in future AI meal estimates.

## Latest Progress

The Goals tab now has a Food Memory card backed by localStorage. Saved memory is included in encrypted sync exports/imports and sent to the Netlify meal analyzer, where the OpenAI prompt treats matching saved foods as authoritative context.

## Smallest Next Step

Test the deployed app with a saved entry such as "Ratio cereal: 1 serving is 220 calories and 20g protein", then estimate a meal that mentions Ratio cereal.
