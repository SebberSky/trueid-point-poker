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

Default: [`/poker/room-hosts-ctrl`](http://localhost:5174/poker/room-hosts-ctrl)

Set host emails per room there. Configure `ADMIN_PATH` in `server/.env`.

## Quick start

```bash
# server/.env — see server/.env.example
cd server && npm install && npm run dev
cd client && npm install && npm run dev
```

- App: http://localhost:5174/poker/
- API: http://localhost:3002

## Run (โฮสต์ = agent3)

รันบนเครื่อง **`agent3s-imac`** คู่กับ TrueID Office — ใช้ **Jenkins webhook / pm2**  
พอร์ตไม่ชน office: **web `5174` / API `3002`** (office = `5173` / `3001`)  
Vite `base` = **`/poker/`** · Office ใช้ **`/office/`** · Funnel **root `/` ไม่ผูกแอป**

### ให้คนอื่นเข้า

| ใคร | URL |
|-----|-----|
| Point Poker | `https://agent3s-imac.taildc5084.ts.net/poker/` |
| TrueID Office | `https://agent3s-imac.taildc5084.ts.net/office/` |
| Root `/` | ไม่พาไปแอปไหน (ต้องใส่ path เอง) |
| เครื่องโฮสต์เอง | `http://localhost:5174/poker/` |

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
```

### Tailscale Serve / Funnel (path แยก — ไม่ผูก `/`)

```bash
cd ~/apps/trueid-point-poker
bash scripts/configure-funnel-paths.sh
# หรือมือ:
#   tailscale serve reset
#   tailscale funnel reset
#   tailscale funnel --bg --set-path=/office http://127.0.0.1:5173/office
#   tailscale funnel --bg --set-path=/poker  http://127.0.0.1:5174/poker
#   tailscale funnel status
# ห้ามรัน: tailscale funnel --bg on  (จะ error target "http://on")
```

จากนั้นเปิดเฉพาะ:

- https://agent3s-imac.taildc5084.ts.net/poker/
- https://agent3s-imac.taildc5084.ts.net/office/

### Jenkins job (2.568.x — มี `githubPush` ไม่มี Generic Webhook Trigger)

1. New Item → **Pipeline**
2. Pipeline from SCM → Git → `https://github.com/SebberSky/trueid-point-poker`
3. Branch: `*/main` · Script Path: `Jenkinsfile`
4. Agent label: `agent3`
5. **Build Now ครั้งแรก** ให้ `githubPush()` จาก Jenkinsfile ติดใน job
6. GitHub → [repo Settings → Webhooks](https://github.com/SebberSky/trueid-point-poker/settings/hooks) → Add webhook:

| ช่อง | ค่า |
|------|-----|
| Payload URL | `http://<JENKINS_URL>/github-webhook/` |
| Content type | `application/json` |
| Events | Just the **push** event |

`<JENKINS_URL>` = URL ที่เปิด Jenkins ได้จากเน็ต/Tailscale (เช่น `http://agent3s-imac:8080`)

รีสตาร์ทมือ: กด **Build Now** ใน job หรือบนโฮสต์:

```bash
cd ~/apps/trueid-point-poker && npm run restart:host
```

Job: `checkout` → `scripts/jenkins-restart.sh` (pm2 ที่โฟลเดอร์ถาวร) แล้วจบ
