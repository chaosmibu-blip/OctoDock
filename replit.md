# Blank Fullstack JavaScript App

## Overview
A blank fullstack JavaScript application built with React (frontend) and Express (backend), ready for development.

## Tech Stack
- **Frontend**: React + TypeScript, Tailwind CSS, Shadcn UI components, Wouter routing, TanStack Query
- **Backend**: Express.js + TypeScript
- **Storage**: In-memory (MemStorage) - can be upgraded to PostgreSQL
- **Build**: Vite

## Project Structure
- `client/src/pages/` - Page components (home.tsx, not-found.tsx)
- `client/src/components/ui/` - Shadcn UI components
- `client/src/hooks/` - Custom hooks
- `client/src/lib/` - Utilities (queryClient, utils)
- `server/` - Express backend (routes.ts, storage.ts)
- `shared/schema.ts` - Shared data schemas (Drizzle + Zod)

## Running
- `npm run dev` starts the dev server (Express + Vite)
