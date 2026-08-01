# TrueID Point Poker

Realtime Scrum planning poker ranked by your Jira boards.

## Flow

1. Sign in with `@truedigital.com` / `@muze.co.th`
2. Pick a board — **room id = project key** (VAL, IMP, …)
3. If you were ever assigned on that project → enter immediately
4. Otherwise wait for a **host** to approve

Membership is stored as CSV under `server/data/rooms/<ROOM>.csv`.

## Admin (secret path)

No UI link. Open:

`/<ADMIN_PATH>`

Default: [`/room-hosts-ctrl`](http://localhost:5173/room-hosts-ctrl)

Set host emails per room there. Configure `ADMIN_PATH` in `server/.env`.

## Quick start

```bash
# server/.env — see server/.env.example
cd server && npm install && npm run dev
cd client && npm install && npm run dev
```

- App: http://localhost:5173
- API: http://localhost:3001
