# Dataset generation prompt

Create diverse, realistic LiftCut-Coach supervised fine-tuning examples.

For each example:

1. Choose either `generate_training_plan` or `generate_nutrition_plan`.
2. Produce a complete, non-identifying `profile_snapshot` and realistic constraints.
3. Produce an `output` that exactly follows the corresponding LiftCut Zod schema.
4. Return JSONL only: one complete JSON object per line.
5. Do not include Markdown fences, commentary, API keys, real user records, or server details.
6. Vary locale, goals, training experience, location, equipment, schedule, diet preference, and restrictions.
7. Include difficult constraint combinations, but keep the plan safe and executable.

Generated records are candidates only. They must pass `npm run research:validate` and human review before entering a training set.
