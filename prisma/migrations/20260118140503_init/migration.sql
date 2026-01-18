-- CreateTable
CREATE TABLE "WeekPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekStartDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlanRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "weekPlanId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
    "setsText" TEXT NOT NULL,
    "repsTimeText" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "PlanRow_weekPlanId_fkey" FOREIGN KEY ("weekPlanId") REFERENCES "WeekPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "exerciseOrActivity" TEXT NOT NULL,
    "setsCompleted" INTEGER,
    "km" REAL,
    "circuitsCompleted" INTEGER,
    "xp" INTEGER NOT NULL,
    "notes" TEXT,
    "linkedPlanRowId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogEntry_linkedPlanRowId_fkey" FOREIGN KEY ("linkedPlanRowId") REFERENCES "PlanRow" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
