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

Default: [`/room-hosts-ctrl`](http://localhost:5174/room-hosts-ctrl)

Set host emails per room there. Configure `ADMIN_PATH` in `server/.env`.

## Quick start

```bash
# server/.env — see server/.env.example
cd server && npm install && npm run dev
cd client && npm install && npm run dev
```

- App: http://localhost:5174
- API: http://localhost:3002

## Run (โฮสต์ = agent3)

รันบนเครื่อง **`agent3s-imac`** คู่กับ TrueID Office — ใช้ **Jenkins webhook / pm2**  
พอร์ตไม่ชน office: **web `5174` / API `3002`** (office = `5173` / `3001`)

### ให้คนอื่นเข้า

| ใคร | URL |
|-----|-----|
| เครื่องโฮสต์เอง | `http://localhost:5174/` |
| Tailscale / Funnel | ดู `npm run share-info` หลัง deploy |

Webhook จะ: sync `~/apps/trueid-point-poker` → `npm ci` (root/server/client) → `pm2 restart`

### ครั้งแรกบน agent3

```bash
mkdir -p ~/apps
git clone https://github.com/SebberSky/trueid-point-poker.git ~/apps/trueid-point-poker
cd ~/apps/trueid-point-poker
cp server/.env.example server/.env
# ใส่ Jira + admin credentials ใน server/.env
npm ci && npm ci --prefix server && npm ci --prefix client
npx pm2 start ecosystem.config.cjs
npx pm2 save
# (ออปชัน) ขึ้นหลังรีบูต: npx pm2 startup
# (ออปชัน) คนนอก: tailscale funnel --bg 5174
```

### Jenkins job (เช่น 2.568.x)

1. New Item → **Pipeline**
2. Pipeline from SCM → Git → `https://github.com/SebberSky/trueid-point-poker`
3. Branch: `*/main` · Script Path: `Jenkinsfile`
4. Agent label: `agent3`
5. **Build Now ครั้งแรก** — ให้ `GenericTrigger` ใน `Jenkinsfile` ลงทะเบียน token (UI มักไม่มีช่อง Token)
6. Webhook URL:

```text
http://<JENKINS_URL>/generic-webhook-trigger/invoke?token=trueid-point-poker
```

ทดสอบ: `curl -X POST 'http://<JENKINS_URL>/generic-webhook-trigger/invoke?token=trueid-point-poker'`  
(ออปชัน) GitHub → Settings → Webhooks → Payload URL = URL ด้านบน

Job: `checkout` → `scripts/jenkins-restart.sh` (pm2 ที่โฟลเดอร์ถาวร) แล้วจบ

รีสตาร์ทมือบนโฮสต์:

```bash
cd ~/apps/trueid-point-poker && npm run restart:host
```
