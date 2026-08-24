# Workout Log

A lightweight, personal, web-based workout logging app with XP gamification. Optimized for fast mobile logging.

## Features

- **XP Gamification**: Earn XP for every workout
  - Gym: 1 XP per set
  - Running: 3 XP per km
  - Circuits: 15 XP per circuit
  - Activity: Manual XP entry

- **Weekly Plan Import**: Paste Markdown tables from chat apps
- **Fast Logging**: Log workouts in under 10 seconds
- **Progress Tracking**: Weekly XP trends and type breakdown

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Set up the database:
```bash
npx prisma migrate dev
```

3. Start the dev server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

Create a `.env` file (already exists with defaults):

```
DATABASE_URL="file:./dev.db"
```

## Deployment

### Vercel + Turso (Recommended - Free)

This setup uses Turso (cloud SQLite) with Vercel's free tier.

**Step 1: Create Turso Database**

1. Sign up at [turso.tech](https://turso.tech) (free tier: 9GB storage, 500 databases)

2. Install Turso CLI and login:
```bash
# macOS/Linux
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login

# Windows - use WSL or download from GitHub releases
```

3. Create database and get credentials:
```bash
turso db create workout-log
turso db show workout-log --url        # Copy this URL
turso db tokens create workout-log     # Copy this token
```

4. Push your schema to Turso:
```bash
turso db shell workout-log < prisma/migrations/*/migration.sql
```

**Step 2: Deploy to Vercel**

1. Push your code to GitHub

2. Import to Vercel at [vercel.com/new](https://vercel.com/new)

3. Add environment variables:
   - `TURSO_DATABASE_URL` = `libsql://workout-log-yourusername.turso.io`
   - `TURSO_AUTH_TOKEN` = `your-token-here`
   - `DATABASE_URL` = `file:./dev.db` (needed for build)
   - `TZ` = `Europe/London` (your local timezone — **required** so streaks,
     session days and weekly goals bucket logs by *your* calendar day; Vercel
     functions otherwise run in UTC and evening logs can drift a day)

4. Deploy!

### Render (Paid - $7/mo)

Render's Starter tier supports persistent disks for SQLite.

1. Push your code to GitHub

2. Go to [render.com](https://render.com) → **New** → **Web Service**

3. Select **Starter** plan ($7/mo) - required for persistent disks

4. Configure:
   - **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
   - **Start Command**: `npm start`

5. Add environment variables:
   - `DATABASE_URL` = `file:/data/workout.db`

6. Add a persistent disk:
   - **Mount Path**: `/data`
   - **Size**: 1 GB

7. Deploy!

## Pasting Plans from Phone

The primary way to create a plan is pasting a Markdown table. Here's the exact format:

```markdown
| Day | Type | Notes | Exercise / Activity | Sets | Reps / Time |
|-----|------|-------|---------------------|------|-------------|
| Monday | Gym | Push Day - 60kg bench | Bench Press | 4 | 8-10 |
| | | 40kg | Overhead Press | 3 | 8-12 |
| Tuesday | Run | Easy pace | Steady Run | 1 | 5 km |
```

### Rules

- Headers must match exactly: `Day | Type | Notes | Exercise / Activity | Sets | Reps / Time`
- Empty cells inherit from the row above
- First row must have all values filled
- Use "Load Example" button to see a complete plan

### Tips for Mobile

1. Copy the table from your chat app (ChatGPT, Claude, etc.)
2. Open the Plans tab
3. Long-press the textarea and Paste
4. Tap "Parse & Preview" to validate
5. Tap "Save Week" to save

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── logs/route.ts      # Log CRUD
│   │   ├── plans/route.ts     # Plan CRUD
│   │   ├── progress/route.ts  # Progress data
│   │   └── week/route.ts      # Current week data
│   ├── plans/page.tsx         # Plans screen
│   ├── progress/page.tsx      # Progress screen
│   ├── layout.tsx
│   └── page.tsx               # This Week screen
├── components/
│   ├── FastLogButton.tsx      # Floating + button
│   ├── Navigation.tsx         # Bottom nav
│   ├── ThisWeek.tsx          # Main logging UI
│   └── XPToast.tsx           # "+X XP" toast
└── lib/
    ├── db.ts                  # Prisma client
    ├── markdown-parser.ts     # Table parser
    └── types.ts               # Shared types
```

## Database Schema

- **WeekPlan**: Weekly plan metadata
- **PlanRow**: Individual exercises in a plan
- **LogEntry**: Logged workouts with stored XP

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS
- Prisma + SQLite
- Lucide React (icons)
