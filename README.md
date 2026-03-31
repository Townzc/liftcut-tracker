# LiftCut Tracker

LiftCut Tracker is a minimal training plan and fat-loss tracking web MVP.

Focus of v1:
- See your training plan clearly
- Log each workout quickly
- Track food and body metrics daily
- Get simple daily/weekly feedback

No backend, no login, no database. Data is persisted in browser localStorage.

## Tech Stack

- Next.js 16 (App Router)
- TypeScript (strict mode)
- Tailwind CSS v4
- shadcn/ui
- Recharts
- Lucide React
- Zustand (persist middleware)
- Zod (JSON validation)

## Run Locally

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

## Routes and Pages

- `/` Dashboard
  - Today plan card
  - Today nutrition summary (calories/protein/remaining)
  - Last 7 days body-weight chart
  - Weekly workout completion
  - Weekly status summary

- `/plan` Training plan
  - Week 1-12 switch
  - Day switch
  - Exercise details (sets, rep range, target RPE, notes, alternatives)
  - Create blank plan
  - Import/export plan JSON

- `/workout` Workout logging
  - Select date/week/day
  - Log actual weight/reps/RPE/completed for each exercise
  - Log duration and notes
  - Mark full workout complete
  - Save updates dashboard immediately

- `/nutrition` Nutrition logging
  - Add/edit/delete food logs
  - Meal type (breakfast/lunch/dinner/snack)
  - Daily total calories/protein
  - Quick add common foods

- `/body` Body metrics
  - Log date, weight, waist, notes
  - 7-day average weight
  - Weekly trend
  - Waist trend
  - Weight and waist line charts
  - Date-based history list

- `/settings` Settings and data management
  - Height, current weight, target weight
  - Weekly training days
  - Calorie target, protein target
  - Weekly loss target min/max
  - Import plan JSON
  - Export all data JSON
  - Reset local data with second confirmation

## Data Model

Core types are in `src/types/index.ts`:

- `UserSettings`
- `TrainingPlan`
- `PlanWeek`
- `PlanDay`
- `ExercisePlan`
- `WorkoutLog`
- `ExerciseLog`
- `FoodLog`
- `BodyMetricLog`
- `AppDataSnapshot`

## Import Training Plan JSON

1. Open `/plan` or `/settings`
2. Choose a `.json` file
3. File is validated with Zod schema
4. If valid, current plan is replaced
5. If invalid, user gets a friendly error

Sample file:

- `public/samples/sample-training-plan.json`

## Export Data

Open `/settings`, then click `Export All Data JSON`.

Output filename format:

- `liftcut-backup-YYYY-MM-DD.json`

The export includes:

- settings
- trainingPlan
- workoutLogs
- foodLogs
- bodyMetricLogs
- quickFoods

## Built-in Demo Data

On first open, app includes:

- A 12-week demo training plan
- Quick foods (egg, milk, greek yogurt, whey protein, chicken breast, rice)
- Sample body metric logs
- Sample workout and nutrition logs

## Project Structure

```text
src/
  app/
    page.tsx
    plan/page.tsx
    workout/page.tsx
    nutrition/page.tsx
    body/page.tsx
    settings/page.tsx
  components/
    layout/
    dashboard/
    plan/
    workout/
    nutrition/
    body/
    settings/
    charts/
    shared/
    ui/
  lib/
    date.ts
    metrics.ts
    demo-data.ts
    schemas.ts
    import-export.ts
    plan.ts
  store/
    use-tracker-store.ts
  types/
    index.ts
public/
  samples/sample-training-plan.json
```

## Future Extension Ideas

- Backend API and account sync
- Database persistence and migrations
- Smarter progression suggestions
- Larger nutrition templates
- PWA offline support and mobile UX improvements