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

### Vercel (Recommended)

1. Push your code to GitHub

2. Import to Vercel:
   - Connect your GitHub repo
   - Vercel auto-detects Next.js

3. Add environment variable:
   - `DATABASE_URL`: For production, use a cloud database like Turso or PlanetScale

4. Deploy!

### Render

Render supports persistent disks, making it ideal for SQLite databases.

1. Push your code to GitHub

2. Go to [render.com](https://render.com) → **New** → **Web Service**

3. Connect your GitHub repo and configure:
   - **Root Directory**: Leave blank (or `.` if your code is in root)
   - **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
   - **Start Command**: `npm start`

4. Add environment variables (in the **Environment** section):
   - `DATABASE_URL` = `file:/data/workout.db`
   - `NODE_ENV` = `production`

5. Add a persistent disk (scroll down to **Disks** section):
   - Click **Add Disk**
   - **Name**: `workout-data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB

6. Click **Create Web Service**

The disk persists your SQLite database across deploys and restarts. Render's free tier includes 1 disk.

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
