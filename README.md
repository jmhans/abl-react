# ABL React - Actuarial Baseball League (React Migration)

This is the new React/Next.js version of the ABL fantasy baseball application, migrating from the Angular version.

## Tech Stack

- **Next.js 16** with App Router
- **React 19**
- **TypeScript** (strict mode)
- **Tailwind CSS 4**
- **Shared Express/MongoDB backend** (from the Angular app)

## Getting Started

### 1. Make sure the Express backend is running

```bash
# In the abl/ directory
cd ../abl
node server.js
# Should start on http://localhost:3000
```

### 2. Start the React dev server

```bash
# In this directory (abl-react/)
npm run dev
# Runs on http://localhost:3001
```

Visit [http://localhost:3001](http://localhost:3001)

## Migration Status

### ✅ Completed
- [x] Initial Next.js setup with TypeScript
- [x] API client for backend communication
- [x] TypeScript interfaces (Team, Game, Player, etc.)
- [x] Home page with navigation
- [x] Games list page

### 📋 To Do
- [ ] Teams page
- [ ] Team detail/roster page  
- [ ] Standings page
- [ ] Game detail page
- [ ] Authentication (Auth0)
- [ ] Admin functionality
- [ ] Draft system
- [ ] Real-time updates

## Development Notes

- React app: **port 3001** | Backend: **port 3000**
- Both apps share the same Express/MongoDB backend
- Angular version continues on Heroku during migration
- API calls proxied to backend via `next.config.ts`
