const ALLOWED_EMAIL =
  /^[a-z0-9._%+-]+@(?:truedigital\.com|muze\.co\.th)$/i

const JIRA_BASE_DEFAULT = 'https://truedmp.atlassian.net'

/** @type {{ boards: any[], fetchedAt: number } | null} */
let boardCache = null
const BOARD_CACHE_MS = 10 * 60 * 1000

export function isAllowedEmail(email) {
  return ALLOWED_EMAIL.test(String(email || '').trim())
}

function jiraBase() {
  return (process.env.JIRA_BASE_URL || JIRA_BASE_DEFAULT).replace(/\/$/, '')
}

function jiraConfig() {
  const base = jiraBase()
  const email = process.env.JIRA_EMAIL || ''
  const token = process.env.JIRA_API_TOKEN || ''
  if (!email || !token) {
    throw new Error('Jira is not configured (JIRA_EMAIL / JIRA_API_TOKEN)')
  }
  return { base, email, token }
}

/**
 * Server-wide default Jira credentials (used until a room host token is set).
 * @returns {{ email: string, token: string }}
 */
export function defaultJiraAuth() {
  const { email, token } = jiraConfig()
  return { email, token }
}

function authHeader() {
  const { email, token } = jiraConfig()
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
}

/**
 * @param {{ email: string, token: string }} auth
 */
function authHeaderFrom(auth) {
  return `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`
}

/**
 * @param {string} path
 * @param {RequestInit & { auth?: { email: string, token: string } }} [init]
 */
async function jiraFetch(path, init = {}) {
  const { auth, headers, ...rest } = init
  const base = jiraBase()
  const authorization =
    auth?.email && auth?.token ? authHeaderFrom(auth) : authHeader()
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      ...(headers || {}),
    },
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const err = new Error(`Jira ${res.status} ${path}`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

/**
 * Stream binary attachment content/thumbnail from Jira.
 * @param {string} attachmentId
 * @param {'content' | 'thumbnail'} [kind]
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function fetchAttachmentBinary(
  attachmentId,
  kind = 'content',
  auth = null,
) {
  const id = String(attachmentId || '').trim()
  if (!/^\d+$/.test(id)) {
    return { error: 'Invalid attachment id', status: 400 }
  }
  const pathKind = kind === 'thumbnail' ? 'thumbnail' : 'content'
  const { base } = jiraConfig()
  const authorization =
    auth?.email && auth?.token ? authHeaderFrom(auth) : authHeader()
  const res = await fetch(
    `${base}/rest/api/3/attachment/${pathKind}/${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization: authorization,
        Accept: '*/*',
      },
      redirect: 'follow',
    },
  )
  if (!res.ok) {
    return { error: 'Attachment not found', status: res.status === 404 ? 404 : 502 }
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  return {
    buffer,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  }
}

/**
 * @param {string} id
 * @param {'content' | 'thumbnail'} kind
 * @param {string} [roomId]
 */
function attachmentProxyUrl(id, kind, roomId = '') {
  const path = `/poker/api/attachments/${id}/${kind}`
  const room = String(roomId || '').trim()
  return room ? `${path}?roomId=${encodeURIComponent(room)}` : path
}

function rewriteAttachmentUrls(html, base, roomId = '') {
  if (!html || typeof html !== 'string') return null
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const qs = String(roomId || '').trim()
    ? `?roomId=${encodeURIComponent(String(roomId).trim())}`
    : ''
  let out = html
    .replace(
      new RegExp(`${escaped}/rest/api/[23]/attachment/content/(\\d+)`, 'gi'),
      `/poker/api/attachments/$1/content${qs}`,
    )
    .replace(
      new RegExp(`${escaped}/rest/api/[23]/attachment/thumbnail/(\\d+)`, 'gi'),
      `/poker/api/attachments/$1/thumbnail${qs}`,
    )
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    // Jira media/connect stubs that only work inside Jira UI
    .replace(
      /<[^>]+>\s*Couldn['’]?t load plugin\s*<\/[^>]+>/gi,
      '',
    )
    .replace(/\bCouldn['’]?t load plugin\b/gi, '')
  if (/Couldn['’]?t load plugin/i.test(out)) return null
  return out
}

/**
 * @param {any} node
 * @param {(node: any) => void} visit
 */
function walkAdf(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.content || []) walkAdf(child, visit)
}

/**
 * @param {string} mimeType
 * @param {string} filename
 */
function attachmentKind(mimeType, filename) {
  const mime = String(mimeType || '').toLowerCase()
  const name = String(filename || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) {
    return 'image'
  }
  if (
    mime.startsWith('video/') ||
    /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(name)
  ) {
    return 'video'
  }
  if (
    mime.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)
  ) {
    return 'audio'
  }
  if (mime === 'application/pdf' || mime.includes('pdf') || /\.pdf$/i.test(name)) {
    return 'pdf'
  }
  return 'file'
}

/**
 * Map attachment ids + ADF media UUIDs → proxied media metadata.
 * @param {Array<{ id: string, filename: string, mimeType: string, contentUrl: string }>} attachments
 * @param {...any} docs
 */
function buildMediaIndex(attachments, ...docs) {
  /** @type {Record<string, { url: string, mimeType: string, filename: string, kind: string }>} */
  const index = {}
  for (const a of attachments) {
    index[a.id] = {
      url: a.contentUrl,
      mimeType: a.mimeType,
      filename: a.filename,
      kind: attachmentKind(a.mimeType, a.filename),
    }
  }
  const byFilename = new Map(
    attachments.map((a) => [String(a.filename || '').toLowerCase(), a]),
  )

  for (const doc of docs) {
    walkAdf(doc, (node) => {
      if (node.type !== 'media') return
      const id = String(node.attrs?.id || '')
      if (!id || index[id]) return
      const alt = String(node.attrs?.alt || '').toLowerCase()
      const hit = alt ? byFilename.get(alt) : null
      if (!hit) return
      index[id] = {
        url: hit.contentUrl,
        mimeType: hit.mimeType,
        filename: hit.filename,
        kind: attachmentKind(hit.mimeType, hit.filename),
      }
    })
  }
  return index
}

/**
 * @param {string} email
 */
export async function findJiraUserByEmail(email) {
  const normalized = email.trim().toLowerCase()
  const q = encodeURIComponent(normalized)
  const users = await jiraFetch(`/rest/api/3/user/search?query=${q}&maxResults=20`)
  if (!Array.isArray(users) || users.length === 0) return null

  const exact = users.find(
    (u) => String(u.emailAddress || '').toLowerCase() === normalized,
  )
  // Cloud often hides emailAddress; an exact email query typically returns one hit.
  const user = exact || (users.length === 1 ? users[0] : null)
  if (!user?.accountId) return null

  return {
    accountId: user.accountId,
    displayName: user.displayName,
    emailAddress: user.emailAddress || normalized,
  }
}

export async function listAllBoards() {
  const now = Date.now()
  if (boardCache && now - boardCache.fetchedAt < BOARD_CACHE_MS) {
    return boardCache.boards
  }

  const boards = []
  let startAt = 0
  for (;;) {
    const data = await jiraFetch(
      `/rest/agile/1.0/board?maxResults=50&startAt=${startAt}`,
    )
    boards.push(
      ...(data.values || []).map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        projectKey: b.location?.projectKey || null,
        projectName: b.location?.projectName || b.location?.displayName || null,
      })),
    )
    if (startAt + (data.maxResults || 50) >= (data.total || 0)) break
    startAt += data.maxResults || 50
    if (startAt > 5000) break
  }

  boardCache = { boards, fetchedAt: now }
  return boards
}

const ASSIGNMENT_LOOKBACK_DAYS = 15

/**
 * Count issues assigned to accountId in the last N days, grouped by project key.
 * @param {string} accountId
 * @param {number} [days]
 */
async function assignmentCountsByProject(accountId, days = ASSIGNMENT_LOOKBACK_DAYS) {
  /** @type {Record<string, number>} */
  const counts = {}
  let nextPageToken = null
  let fetched = 0
  const hardCap = 2000

  for (;;) {
    /** @type {Record<string, unknown>} */
    const body = {
      jql: `assignee = "${accountId}" AND updated >= -${days}d ORDER BY updated DESC`,
      fields: ['project'],
      maxResults: 100,
    }
    if (nextPageToken) body.nextPageToken = nextPageToken

    const data = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    for (const issue of data.issues || []) {
      const key = issue.fields?.project?.key
      if (key) counts[key] = (counts[key] || 0) + 1
    }
    fetched += (data.issues || []).length

    if (data.isLast || !data.nextPageToken || fetched >= hardCap) break
    nextPageToken = data.nextPageToken
  }

  return counts
}

/**
 * True if account was ever assignee on any issue in the project.
 * @param {string} accountId
 * @param {string} projectKey
 */
export async function hasProjectAssignment(accountId, projectKey) {
  const key = String(projectKey || '')
    .trim()
    .toUpperCase()
  if (!key) return false

  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: `assignee = "${accountId}" AND project = ${key}`,
      fields: ['key'],
      maxResults: 1,
    }),
  })
  return Array.isArray(data.issues) && data.issues.length > 0
}

const ISSUE_LIST_BASE_FIELDS = ['summary', 'status', 'issuetype', 'assignee']
/** Only keep a closed sprint if it ended within this window. */
const PREVIOUS_SPRINT_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000
/** Cap backlog size — board backlog can contain years of ranked issues. */
const BACKLOG_MAX_ISSUES = 60
/** Prefer recently touched backlog items when ranking alone still surfaces stale work. */
const BACKLOG_UPDATED_WITHIN_DAYS = 120

/**
 * @param {any} issue
 * @param {string[]} [storyPointIds]
 */
function mapIssue(issue, storyPointIds = []) {
  const { base } = jiraConfig()
  return {
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || '',
    statusCategory: issue.fields?.status?.statusCategory?.key || '',
    issuetype: issue.fields?.issuetype?.name || '',
    assignee: issue.fields?.assignee?.displayName || null,
    url: `${base}/browse/${issue.key}`,
    storyPoints: storyPointsFromFields(issue.fields || {}, storyPointIds),
  }
}

/**
 * @param {{ email: string, token: string } | null} [auth]
 */
async function issueListFieldPlan(auth = null) {
  const authOpt = auth ? { auth } : {}
  const storyPointIds = await loadStoryPointFieldIds(authOpt)
  return {
    storyPointIds,
    csv: [...ISSUE_LIST_BASE_FIELDS, ...storyPointIds].join(','),
    array: [...ISSUE_LIST_BASE_FIELDS, ...storyPointIds],
  }
}

/**
 * @param {any} sprint
 */
function sprintEndTime(sprint) {
  return Date.parse(sprint?.completeDate || sprint?.endDate || '') || 0
}

/**
 * Finished tickets stuck in a sprint should not appear in planning lists.
 * @param {any} issue
 */
function isClosedIssue(issue) {
  const category = issue.fields?.status?.statusCategory?.key
  if (category === 'done') return true
  const name = String(issue.fields?.status?.name || '')
    .trim()
    .toLowerCase()
  return name === 'closed'
}

/**
 * @param {number|string} boardId
 * @param {number|string} sprintId
 * @param {{ email: string, token: string } | null} [auth]
 */
async function fetchSprintIssues(
  boardId,
  sprintId,
  auth = null,
  fieldCsv = ISSUE_LIST_BASE_FIELDS.join(','),
  storyPointIds = [],
) {
  const authOpt = auth ? { auth } : {}
  const issues = []
  let startAt = 0
  for (;;) {
    const data = await jiraFetch(
      `/rest/agile/1.0/board/${boardId}/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=50&fields=${fieldCsv}`,
      authOpt,
    )
    for (const issue of data.issues || []) {
      if (isClosedIssue(issue)) continue
      issues.push(mapIssue(issue, storyPointIds))
    }
    const total = data.total ?? startAt + (data.issues || []).length
    startAt += data.maxResults || 50
    if (startAt >= total || !(data.issues || []).length || startAt > 400) break
  }
  return issues
}

/**
 * @param {number|string} boardId
 * @param {string} [jql]
 * @param {{ email: string, token: string } | null} [auth]
 */
async function fetchBacklogIssues(
  boardId,
  jql,
  auth = null,
  fieldCsv = ISSUE_LIST_BASE_FIELDS.join(','),
  storyPointIds = [],
) {
  const authOpt = auth ? { auth } : {}
  const issues = []
  let startAt = 0
  const query = jql ? `&jql=${encodeURIComponent(jql)}` : ''
  for (;;) {
    const data = await jiraFetch(
      `/rest/agile/1.0/board/${boardId}/backlog?startAt=${startAt}&maxResults=50&fields=${fieldCsv}${query}`,
      authOpt,
    )
    for (const issue of data.issues || []) {
      issues.push(mapIssue(issue, storyPointIds))
      if (issues.length >= BACKLOG_MAX_ISSUES) return issues
    }
    const total = data.total ?? startAt + (data.issues || []).length
    startAt += data.maxResults || 50
    if (startAt >= total || !(data.issues || []).length || startAt > 400) break
  }
  return issues
}

/**
 * @param {number|string} boardId
 * @param {{ email: string, token: string } | null} [auth]
 */
async function fetchRecentBacklogIssues(
  boardId,
  auth = null,
  fieldCsv = ISSUE_LIST_BASE_FIELDS.join(','),
  storyPointIds = [],
) {
  try {
    return await fetchBacklogIssues(
      boardId,
      `updated >= -${BACKLOG_UPDATED_WITHIN_DAYS}d`,
      auth,
      fieldCsv,
      storyPointIds,
    )
  } catch {
    return fetchBacklogIssues(
      boardId,
      undefined,
      auth,
      fieldCsv,
      storyPointIds,
    )
  }
}

/**
 * Active + recent closed sprint + planned future sprints + capped backlog.
 * @param {number|string} boardId
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function getBoardPlanningTickets(boardId, auth = null) {
  const id = Number(boardId)
  if (!Number.isFinite(id)) {
    return { error: 'Invalid board id', status: 400 }
  }

  const authOpt = auth ? { auth } : {}
  const { csv: fieldCsv, storyPointIds } = await issueListFieldPlan(auth)
  const [active, closed, future] = await Promise.all([
    jiraFetch(
      `/rest/agile/1.0/board/${id}/sprint?state=active&maxResults=10`,
      authOpt,
    ),
    jiraFetch(
      `/rest/agile/1.0/board/${id}/sprint?state=closed&maxResults=50`,
      authOpt,
    ),
    jiraFetch(
      `/rest/agile/1.0/board/${id}/sprint?state=future&maxResults=50`,
      authOpt,
    ),
  ])

  /** @type {{ id: number, name: string, state?: string, issues: ReturnType<typeof mapIssue>[] }[]} */
  const activeSprints = []
  for (const sprint of active.values || []) {
    const issues = await fetchSprintIssues(
      id,
      sprint.id,
      auth,
      fieldCsv,
      storyPointIds,
    )
    if (issues.length === 0) continue
    activeSprints.push({
      id: sprint.id,
      name: sprint.name,
      state: 'active',
      issues,
    })
  }

  const closedSprints = [...(closed.values || [])]
    .filter((sprint) => sprintEndTime(sprint) > 0)
    .sort((a, b) => {
      const aTime = sprintEndTime(a)
      const bTime = sprintEndTime(b)
      if (bTime !== aTime) return bTime - aTime
      return (b.id || 0) - (a.id || 0)
    })
  const previous = closedSprints[0] || null
  const previousEnd = previous ? sprintEndTime(previous) : 0
  const previousAge = previousEnd ? Date.now() - previousEnd : Infinity

  /** @type {{ id: number, name: string, issues: ReturnType<typeof mapIssue>[] } | null} */
  let previousSprint = null
  if (previous && previousAge <= PREVIOUS_SPRINT_MAX_AGE_MS) {
    const issues = await fetchSprintIssues(
      id,
      previous.id,
      auth,
      fieldCsv,
      storyPointIds,
    )
    if (issues.length > 0) {
      previousSprint = {
        id: previous.id,
        name: previous.name,
        issues,
      }
    }
  }

  const backlogGroups = []
  for (const sprint of future.values || []) {
    const issues = await fetchSprintIssues(
      id,
      sprint.id,
      auth,
      fieldCsv,
      storyPointIds,
    )
    if (issues.length === 0) continue
    backlogGroups.push({
      id: sprint.id,
      name: sprint.name,
      state: 'future',
      issues,
    })
  }

  backlogGroups.push({
    id: 0,
    name: 'Backlog',
    state: 'backlog',
    issues: await fetchRecentBacklogIssues(id, auth, fieldCsv, storyPointIds),
  })

  return { boardId: id, activeSprints, previousSprint, backlogGroups }
}

function escapeJqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Search issues across all projects (no status/project filters).
 * Matches summary, issue key, and assignee display name.
 * @param {string} query
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function searchIssues(query, auth = null) {
  const q = String(query || '').trim()
  if (!q) return { issues: [], query: q }
  if (q.length > 100) return { error: 'Query too long', status: 400 }

  const authOpt = auth ? { auth } : {}
  const { array: listFields, storyPointIds } = await issueListFieldPlan(auth)
  const escaped = escapeJqlString(q)
  const clauses = [`summary ~ "${escaped}"`]

  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(q)) {
    clauses.push(`key = ${q.toUpperCase()}`)
  }

  /** @type {any[]} */
  let users = []
  try {
    users = await jiraFetch(
      `/rest/api/3/user/search?query=${encodeURIComponent(q)}&maxResults=15`,
      authOpt,
    )
  } catch {
    users = []
  }

  const accountIds = [
    ...new Set(
      (Array.isArray(users) ? users : [])
        .map((u) => u.accountId)
        .filter(Boolean),
    ),
  ]
  if (accountIds.length > 0) {
    clauses.push(
      `assignee in (${accountIds.map((id) => `"${id}"`).join(', ')})`,
    )
  }

  const jql = `(${clauses.join(' OR ')}) ORDER BY updated DESC`
  const data = await jiraFetch('/rest/api/3/search/jql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql,
      maxResults: 40,
      fields: listFields,
    }),
    ...authOpt,
  })

  const byKey = new Map()
  for (const issue of data.issues || []) {
    byKey.set(issue.key, mapIssue(issue, storyPointIds))
  }

  // Issue picker improves partial key / title matches across boards.
  try {
    const picker = await jiraFetch(
      `/rest/api/3/issue/picker?query=${encodeURIComponent(q)}&showSubTasks=true&currentJQL=`,
      authOpt,
    )
    const picks = []
    for (const section of picker.sections || []) {
      for (const issue of section.issues || []) {
        if (issue.key) picks.push(issue.key)
      }
    }
    const missing = picks.filter((key) => !byKey.has(key)).slice(0, 20)
    if (missing.length > 0) {
      const keyJql = `key in (${missing.join(', ')})`
      const extra = await jiraFetch('/rest/api/3/search/jql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql: keyJql,
          maxResults: missing.length,
          fields: listFields,
        }),
        ...authOpt,
      })
      for (const issue of extra.issues || []) {
        byKey.set(issue.key, mapIssue(issue, storyPointIds))
      }
    }
  } catch {
    // picker is best-effort
  }

  return { query: q, issues: [...byKey.values()].slice(0, 50) }
}

const PLATFORM_SINGLE = 'customfield_10134'
const PLATFORM_MULTI = 'customfield_11830'
const PLATFORM_FIELDS = [PLATFORM_SINGLE, PLATFORM_MULTI]
const NEED_QA_FIELD = 'customfield_12252'
const PLATFORM_FALLBACK = ['iOS', 'Android']

function fieldLabels(value) {
  if (value == null || value === '') return []
  const items = Array.isArray(value) ? value : [value]
  const labels = []
  for (const item of items) {
    if (item == null || item === '') continue
    if (typeof item === 'string' || typeof item === 'number') {
      labels.push(String(item))
      continue
    }
    const label = item.value || item.name || item.label
    if (label) labels.push(String(label))
  }
  return labels
}

function uniqueLabels(groups) {
  const seen = new Set()
  const out = []
  for (const group of groups) {
    for (const label of group) {
      if (!seen.has(label)) {
        seen.add(label)
        out.push(label)
      }
    }
  }
  return out
}

function platformsFromFields(f) {
  return uniqueLabels(PLATFORM_FIELDS.map((id) => fieldLabels(f[id])))
}

function titleAfterBrackets(summary) {
  return String(summary || '')
    .replace(/^\s*(?:\[[^\]]*\]\s*)+/, '')
    .trim()
}

function normalizeSummary(value) {
  return titleAfterBrackets(value)
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function mapSameTitleIssue(issue) {
  return {
    ...mapIssue(issue),
    platforms: platformsFromFields(issue.fields || {}),
  }
}

/**
 * @param {string} summary
 * @param {string} [excludeKey]
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function searchIssuesBySummary(
  summary,
  excludeKey = '',
  auth = null,
) {
  const title = titleAfterBrackets(summary)
  const skipKey = String(excludeKey || '')
    .trim()
    .toUpperCase()
  if (!title) return { issues: [], summary: title }

  const authOpt = auth ? { auth } : {}
  const fields = [
    'summary',
    'status',
    'issuetype',
    'assignee',
    ...PLATFORM_FIELDS,
  ]
  const byKey = new Map()
  const escaped = escapeJqlString(title)
  const queries = [
    `summary ~ "\\"${escaped}\\"" ORDER BY key ASC`,
    `summary ~ "${escaped}" ORDER BY key ASC`,
  ]
  const target = normalizeSummary(title)
  for (const jql of queries) {
    try {
      const data = await jiraFetch('/rest/api/3/search/jql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jql,
          maxResults: 50,
          fields,
        }),
        ...authOpt,
      })
      for (const issue of data.issues || []) {
        if (skipKey && issue.key === skipKey) continue
        if (normalizeSummary(issue.fields?.summary) !== target) continue
        byKey.set(issue.key, mapSameTitleIssue(issue))
      }
      if (byKey.size > 0) break
    } catch {
    }
  }

  const issues = [...byKey.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  )
  return { summary: title, issues }
}

function fixVersionsFromFields(f) {
  return fieldLabels(f.fixVersions)
}

function needQaFromFields(f) {
  return fieldLabels(f[NEED_QA_FIELD])[0] || null
}

const NEED_QA_VALUES = ['Yes', 'No']

/**
 * @param {string} issueKey
 * @param {string} needQa
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function setIssueNeedQa(issueKey, needQa, auth = null) {
  const key = String(issueKey || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    return { error: 'Invalid issue key', status: 400 }
  }

  const wanted = String(needQa || '').trim()
  const match = NEED_QA_VALUES.find(
    (value) => value.toLowerCase() === wanted.toLowerCase(),
  )
  if (!match) {
    return { error: 'Need QA must be Yes or No', status: 400 }
  }

  const authOpt = auth ? { auth } : {}
  try {
    await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: { [NEED_QA_FIELD]: { value: match } },
      }),
      ...authOpt,
    })
    return { key, needQa: match }
  } catch (firstErr) {
    try {
      const meta = await jiraFetch(
        `/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`,
        authOpt,
      )
      const allowed = meta?.fields?.[NEED_QA_FIELD]?.allowedValues || []
      const option = allowed.find(
        (item) => String(item.value || '').toLowerCase() === match.toLowerCase(),
      )
      if (!option?.id) {
        return {
          error: 'Need QA is not editable on this issue',
          status: 400,
        }
      }
      await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { [NEED_QA_FIELD]: { id: option.id } },
        }),
        ...authOpt,
      })
      return { key, needQa: match }
    } catch (err) {
      const detail =
        err && typeof err === 'object' && 'data' in err
          ? JSON.stringify(/** @type {any} */ (err).data)
          : err instanceof Error
            ? err.message
            : String(firstErr)
      return {
        error: detail ? `Failed to set Need QA: ${detail}` : 'Failed to set Need QA',
        status: /** @type {any} */ (err)?.status || 502,
      }
    }
  }
}

function optionLabelsFromMeta(field) {
  return fieldLabels(field?.allowedValues || [])
}

function sortVersionNames(versions) {
  const list = Array.isArray(versions) ? versions : []
  return [...list]
    .filter((item) => item && !item.archived)
    .sort((a, b) => {
      const rel = Number(Boolean(a.released)) - Number(Boolean(b.released))
      if (rel !== 0) return rel
      return String(b.name || '').localeCompare(String(a.name || ''), undefined, {
        numeric: true,
      })
    })
    .map((item) => String(item.name || item.value || ''))
    .filter(Boolean)
}

async function fieldContextOptions(fieldId, authOpt) {
  try {
    const contexts = await jiraFetch(
      `/rest/api/3/field/${fieldId}/context?maxResults=50`,
      authOpt,
    )
    const labels = []
    for (const context of (contexts.values || []).slice(0, 5)) {
      const opts = await jiraFetch(
        `/rest/api/3/field/${fieldId}/context/${encodeURIComponent(context.id)}/option?maxResults=100`,
        authOpt,
      )
      for (const option of opts.values || []) {
        if (!option.disabled && option.value) labels.push(String(option.value))
      }
    }
    return uniqueLabels([labels])
  } catch {
    return []
  }
}

async function loadPlatformOptions(editFields, authOpt) {
  const fromMeta = uniqueLabels([
    optionLabelsFromMeta(editFields[PLATFORM_SINGLE]),
    optionLabelsFromMeta(editFields[PLATFORM_MULTI]),
  ])
  if (fromMeta.length) return fromMeta
  const fromContext = uniqueLabels([
    await fieldContextOptions(PLATFORM_SINGLE, authOpt),
    await fieldContextOptions(PLATFORM_MULTI, authOpt),
  ])
  return fromContext.length ? fromContext : PLATFORM_FALLBACK
}

async function loadFixVersionOptions(projectKey, editFields, authOpt) {
  try {
    const versions = await jiraFetch(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`,
      authOpt,
    )
    const names = sortVersionNames(versions)
    if (names.length) return names
  } catch {
  }
  return sortVersionNames(editFields.fixVersions?.allowedValues || [])
}

function writeError(err, fallback) {
  const detail =
    err && typeof err === 'object' && 'data' in err
      ? JSON.stringify(/** @type {any} */ (err).data)
      : err instanceof Error
        ? err.message
        : ''
  return {
    error: detail ? `${fallback}: ${detail}` : fallback,
    status: /** @type {any} */ (err)?.status || 502,
  }
}

async function putIssueFields(key, fields, authOpt) {
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    ...authOpt,
  })
}

function normalizeNames(values) {
  const list = Array.isArray(values) ? values : [values]
  return uniqueLabels([
    list.map((item) => String(item || '').trim()).filter(Boolean),
  ])
}

/**
 * @param {string} issueKey
 * @param {string[]} platforms
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function setIssuePlatforms(issueKey, platforms, auth = null) {
  const key = String(issueKey || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    return { error: 'Invalid issue key', status: 400 }
  }
  const names = normalizeNames(platforms)
  const authOpt = auth ? { auth } : {}
  let editFields = {}
  try {
    const meta = await jiraFetch(
      `/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`,
      authOpt,
    )
    editFields = meta?.fields || {}
  } catch {
    editFields = {}
  }

  const fields = {}
  if (editFields[PLATFORM_MULTI] || !editFields[PLATFORM_SINGLE]) {
    fields[PLATFORM_MULTI] = names.map((value) => ({ value }))
  }
  if (editFields[PLATFORM_SINGLE] || !editFields[PLATFORM_MULTI]) {
    fields[PLATFORM_SINGLE] = names[0] ? { value: names[0] } : null
  }

  try {
    await putIssueFields(key, fields, authOpt)
    return { key, platforms: names }
  } catch (firstErr) {
    for (const [fieldId, value] of Object.entries(fields)) {
      try {
        await putIssueFields(key, { [fieldId]: value }, authOpt)
        return { key, platforms: names }
      } catch {
      }
    }
    return writeError(firstErr, 'Failed to set Platform')
  }
}

/**
 * @param {string} issueKey
 * @param {string[]} versions
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function setIssueFixVersions(issueKey, versions, auth = null) {
  const key = String(issueKey || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    return { error: 'Invalid issue key', status: 400 }
  }
  const names = normalizeNames(versions)
  const projectKey = key.split('-')[0]
  const authOpt = auth ? { auth } : {}

  /** @type {Map<string, { id?: string, name?: string }>} */
  const byName = new Map()
  try {
    const existing = await jiraFetch(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`,
      authOpt,
    )
    for (const version of existing || []) {
      if (version?.name) byName.set(String(version.name).toLowerCase(), version)
    }
  } catch {
  }

  /** @type {{ id: string }[]} */
  const resolved = []
  for (const name of names) {
    let found = byName.get(name.toLowerCase())
    if (!found?.id) {
      try {
        found = await jiraFetch('/rest/api/3/version', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, project: projectKey }),
          ...authOpt,
        })
        if (found?.name) byName.set(String(found.name).toLowerCase(), found)
      } catch (err) {
        return writeError(err, `Fix version "${name}" was not found in Jira`)
      }
    }
    if (!found?.id) {
      return { error: `Fix version "${name}" was not found in Jira`, status: 400 }
    }
    resolved.push({ id: String(found.id) })
  }

  try {
    await putIssueFields(key, { fixVersions: resolved }, authOpt)
    return { key, fixVersions: names }
  } catch (err) {
    return writeError(err, 'Failed to set Fix version')
  }
}

/**
 * @param {string} issueKey
 * @param {{ email: string, token: string } | null} [auth]
 * @param {string} [roomId]
 */
const STORY_POINT_FALLBACK_FIELDS = [
  'customfield_10124',
  'customfield_11210',
  'customfield_13828',
  'customfield_12714',
  'customfield_10016',
]

/** @type {string[] | null} */
let storyPointFieldCache = null

/**
 * @param {{ auth?: { email: string, token: string } }} authOpt
 */
async function loadStoryPointFieldIds(authOpt) {
  if (storyPointFieldCache) return storyPointFieldCache
  const ids = new Set(STORY_POINT_FALLBACK_FIELDS)
  try {
    const fields = await jiraFetch('/rest/api/3/field', authOpt)
    for (const field of Array.isArray(fields) ? fields : []) {
      if (/story\s*points?/i.test(String(field.name || ''))) {
        ids.add(field.id)
      }
    }
  } catch {
  }
  storyPointFieldCache = [...ids]
  return storyPointFieldCache
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string[]} fieldIds
 */
function storyPointsFromFields(fields, fieldIds) {
  for (const id of fieldIds) {
    const raw = fields?.[id]
    if (raw == null || raw === '') continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}

export async function getIssueDetails(issueKey, auth = null, roomId = '') {
  const key = String(issueKey || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    return { error: 'Invalid issue key', status: 400 }
  }

  const authOpt = auth ? { auth } : {}
  const { base } = jiraConfig()
  const storyPointFields = await loadStoryPointFieldIds(authOpt)
  const fields = [
    'summary',
    'description',
    'status',
    'issuetype',
    'priority',
    'assignee',
    'labels',
    'components',
    'comment',
    'attachment',
    'created',
    'updated',
    'parent',
    'fixVersions',
    NEED_QA_FIELD,
    ...PLATFORM_FIELDS,
    ...storyPointFields,
  ].join(',')

  const issue = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}&expand=renderedFields,editmeta`,
    authOpt,
  )
  const f = issue.fields || {}
  const rendered = issue.renderedFields || {}
  const editFields = issue.editmeta?.fields || {}
  const projectKey = key.split('-')[0]
  const [platformOptions, fixVersionOptions] = await Promise.all([
    loadPlatformOptions(editFields, authOpt),
    loadFixVersionOptions(projectKey, editFields, authOpt),
  ])
  const room = String(roomId || '').trim()

  const attachments = (f.attachment || []).map((a) => {
    const mimeType = a.mimeType || 'application/octet-stream'
    const filename = a.filename || 'file'
    const kind = attachmentKind(mimeType, filename)
    return {
      id: String(a.id),
      filename,
      mimeType,
      size: a.size || 0,
      kind,
      isImage: kind === 'image',
      isVideo: kind === 'video',
      isAudio: kind === 'audio',
      contentUrl: attachmentProxyUrl(a.id, 'content', room),
      thumbnailUrl: a.thumbnail
        ? attachmentProxyUrl(a.id, 'thumbnail', room)
        : attachmentProxyUrl(a.id, 'content', room),
    }
  })

  const commentBodies = ((f.comment && f.comment.comments) || []).map(
    (c) => c.body || null,
  )
  const mediaIndex = buildMediaIndex(
    attachments,
    f.description,
    ...commentBodies,
  )
  const mediaUrls = Object.fromEntries(
    Object.entries(mediaIndex).map(([id, meta]) => [id, meta.url]),
  )

  return {
    key: issue.key,
    url: `${base}/browse/${issue.key}`,
    summary: f.summary || '',
    description: f.description || null,
    descriptionHtml: rewriteAttachmentUrls(rendered.description, base, room),
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    issuetype: f.issuetype?.name || '',
    issuetypeIcon: f.issuetype?.iconUrl || null,
    priority: f.priority?.name || '',
    assignee: f.assignee
      ? {
          displayName: f.assignee.displayName,
          avatarUrl: f.assignee.avatarUrls?.['48x48'] || null,
        }
      : null,
    platforms: platformsFromFields(f),
    platformOptions,
    fixVersions: fixVersionsFromFields(f),
    fixVersionOptions,
    needQa: needQaFromFields(f),
    storyPoints: storyPointsFromFields(f, storyPointFields),
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    parent: f.parent
      ? { key: f.parent.key, summary: f.parent.fields?.summary || '' }
      : null,
    created: f.created || null,
    updated: f.updated || null,
    attachments,
    mediaIndex,
    mediaUrls,
    comments: ((f.comment && f.comment.comments) || []).map((c) => {
      const renderedList = rendered.comment?.comments || []
      const renderedMatch =
        renderedList.find((r) => String(r.id) === String(c.id)) || null
      return {
        id: c.id,
        created: c.created,
        author: c.author?.displayName || 'Unknown',
        body: c.body || null,
        bodyHtml: rewriteAttachmentUrls(renderedMatch?.body, base, room),
      }
    }),
  }
}

/**
 * @param {string} issueKey
 * @param {number} boardId
 * @param {number} points
 * @param {{ email: string, token: string } | null} [auth]
 */
async function estimateIssueOnBoard(issueKey, boardId, points, auth = null) {
  return jiraFetch(
    `/rest/agile/1.0/issue/${encodeURIComponent(issueKey)}/estimation?boardId=${boardId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(points) }),
      ...(auth ? { auth } : {}),
    },
  )
}

/**
 * Set story points using the board estimation field (works even when the field
 * is not on the issue edit screen).
 * @param {string} issueKey
 * @param {number|string} points
 * @param {number|string|null} [boardIdHint]
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function setIssueStoryPoints(
  issueKey,
  points,
  boardIdHint = null,
  auth = null,
) {
  const key = String(issueKey || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    return { error: 'Invalid issue key', status: 400 }
  }

  const value = Number(points)
  if (!Number.isFinite(value) || value < 0) {
    return { error: 'Invalid story points value', status: 400 }
  }

  /** @type {number[]} */
  const boardIds = []
  const hint = Number(boardIdHint)
  if (Number.isFinite(hint) && hint > 0) boardIds.push(hint)

  const projectKey = key.split('-')[0]
  const authOpt = auth ? { auth } : {}
  try {
    const boards = await jiraFetch(
      `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&maxResults=50`,
      authOpt,
    )
    for (const board of boards.values || []) {
      const id = Number(board.id)
      if (Number.isFinite(id) && !boardIds.includes(id)) boardIds.push(id)
    }
  } catch {
    // keep hint-only list
  }

  /** @type {Error | null} */
  let lastError = null
  for (const boardId of boardIds) {
    try {
      const result = await estimateIssueOnBoard(key, boardId, value, auth)
      return {
        key,
        points: value,
        boardId,
        fieldId: result?.fieldId || null,
        value: result?.value ?? value,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const fieldIds = [...STORY_POINT_FALLBACK_FIELDS]
  for (const boardId of boardIds.slice(0, 3)) {
    try {
      const config = await jiraFetch(
        `/rest/agile/1.0/board/${boardId}/configuration`,
        authOpt,
      )
      const fieldId = config?.estimation?.field?.fieldId
      if (fieldId && !fieldIds.includes(fieldId)) fieldIds.unshift(fieldId)
    } catch {
      // ignore
    }
  }

  for (const fieldId of fieldIds) {
    try {
      await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [fieldId]: value } }),
        ...authOpt,
      })
      return { key, points: value, fieldId, boardId: null, value }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  const detail =
    lastError && 'data' in lastError
      ? JSON.stringify(/** @type {any} */ (lastError).data)
      : lastError?.message
  return {
    error: detail
      ? `Failed to set story points: ${detail}`
      : 'Failed to set story points',
    status: /** @type {any} */ (lastError)?.status || 502,
  }
}

/**
 * Reorder an issue on the Jira board rank (same sprint / backlog).
 * @param {{ issueKey: string, rankBeforeIssue?: string, rankAfterIssue?: string }} payload
 * @param {{ email: string, token: string } | null} [auth]
 */
export async function rankIssue(payload, auth = null) {
  const issueKey = String(payload?.issueKey || '')
    .trim()
    .toUpperCase()
  const rankBeforeIssue = String(payload?.rankBeforeIssue || '')
    .trim()
    .toUpperCase()
  const rankAfterIssue = String(payload?.rankAfterIssue || '')
    .trim()
    .toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
    return { error: 'Invalid issue key', status: 400 }
  }
  if (rankBeforeIssue && !/^[A-Z][A-Z0-9]+-\d+$/.test(rankBeforeIssue)) {
    return { error: 'Invalid rankBeforeIssue', status: 400 }
  }
  if (rankAfterIssue && !/^[A-Z][A-Z0-9]+-\d+$/.test(rankAfterIssue)) {
    return { error: 'Invalid rankAfterIssue', status: 400 }
  }
  if (!rankBeforeIssue && !rankAfterIssue) {
    return { error: 'rankBeforeIssue or rankAfterIssue is required', status: 400 }
  }

  const body = { issues: [issueKey] }
  if (rankBeforeIssue) body.rankBeforeIssue = rankBeforeIssue
  else body.rankAfterIssue = rankAfterIssue

  try {
    await jiraFetch('/rest/agile/1.0/issue/rank', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(auth ? { auth } : {}),
    })
    return { ok: true, key: issueKey }
  } catch (err) {
    const detail =
      err && typeof err === 'object' && 'data' in err
        ? JSON.stringify(/** @type {any} */ (err).data)
        : err instanceof Error
          ? err.message
          : String(err)
    return {
      error: detail ? `Failed to rank issue: ${detail}` : 'Failed to rank issue',
      status: /** @type {any} */ (err)?.status || 502,
    }
  }
}

/**
 * Prove email ownership with the user's own Atlassian API token.
 * @param {string} email
 * @param {string} apiToken
 */
export async function verifyUserJiraLogin(email, apiToken) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase()
  const token = String(apiToken || '').trim()
  if (!isAllowedEmail(normalized)) {
    return {
      ok: false,
      error: 'Email must be @truedigital.com or @muze.co.th',
      status: 400,
    }
  }
  if (!token) {
    return { ok: false, error: 'API token is required', status: 400 }
  }

  /** @type {any} */
  let me
  try {
    me = await jiraFetch('/rest/api/3/myself', {
      auth: { email: normalized, token },
    })
  } catch (err) {
    const status = /** @type {any} */ (err)?.status
    if (status === 401 || status === 403) {
      return { ok: false, error: 'Invalid email or API token', status: 401 }
    }
    return {
      ok: false,
      error: 'Failed to reach Jira with these credentials',
      status: 502,
    }
  }

  const meEmail = String(me?.emailAddress || '')
    .trim()
    .toLowerCase()
  if (!meEmail) {
    return {
      ok: false,
      error:
        'Jira did not return an email for this token. Make your email visible on your Atlassian profile, then try again.',
      status: 400,
    }
  }
  if (meEmail !== normalized) {
    return {
      ok: false,
      error: `Token belongs to ${meEmail}, not ${normalized}`,
      status: 400,
    }
  }

  return {
    ok: true,
    displayName: me?.displayName || normalized.split('@')[0],
    accountId: me?.accountId || null,
    email: meEmail,
  }
}

/**
 * Verify host email + API token can use Jira and edit the room project.
 * @param {{
 *   email: string,
 *   apiToken: string,
 *   projectKey?: string | null,
 *   boardId?: number | null,
 * }} payload
 */
export async function verifyHostJiraAccess(payload) {
  const email = String(payload?.email || '')
    .trim()
    .toLowerCase()
  const apiToken = String(payload?.apiToken || '').trim()
  const projectKey = String(payload?.projectKey || '')
    .trim()
    .toUpperCase()
  const boardId = Number(payload?.boardId)

  if (!isAllowedEmail(email)) {
    return {
      ok: false,
      error: 'Email must be @truedigital.com or @muze.co.th',
      status: 400,
    }
  }
  if (!apiToken) {
    return { ok: false, error: 'API token is required', status: 400 }
  }

  const auth = { email, token: apiToken }

  /** @type {any} */
  let me
  try {
    me = await jiraFetch('/rest/api/3/myself', { auth })
  } catch (err) {
    const status = /** @type {any} */ (err)?.status
    if (status === 401 || status === 403) {
      return { ok: false, error: 'Invalid email or API token', status: 401 }
    }
    return {
      ok: false,
      error: 'Failed to reach Jira with these credentials',
      status: 502,
    }
  }

  const meEmail = String(me?.emailAddress || '')
    .trim()
    .toLowerCase()
  if (meEmail && meEmail !== email) {
    return {
      ok: false,
      error: `Token belongs to ${meEmail}, not ${email}`,
      status: 400,
    }
  }

  if (projectKey) {
    try {
      const perms = await jiraFetch(
        `/rest/api/3/mypermissions?projectKey=${encodeURIComponent(projectKey)}&permissions=BROWSE_PROJECTS,EDIT_ISSUES`,
        { auth },
      )
      const browse = Boolean(perms?.permissions?.BROWSE_PROJECTS?.havePermission)
      const edit = Boolean(perms?.permissions?.EDIT_ISSUES?.havePermission)
      if (!browse) {
        return {
          ok: false,
          error: `No browse access to project ${projectKey}`,
          status: 403,
        }
      }
      if (!edit) {
        return {
          ok: false,
          error: `No edit-issue permission on project ${projectKey}`,
          status: 403,
        }
      }
    } catch (err) {
      const status = /** @type {any} */ (err)?.status
      return {
        ok: false,
        error:
          status === 404
            ? `Project ${projectKey} not found or inaccessible`
            : `Failed to check permissions on ${projectKey}`,
        status: status || 502,
      }
    }
  }

  if (Number.isFinite(boardId) && boardId > 0) {
    try {
      await jiraFetch(`/rest/agile/1.0/board/${boardId}`, { auth })
      await jiraFetch(`/rest/agile/1.0/board/${boardId}/configuration`, { auth })
    } catch (err) {
      const status = /** @type {any} */ (err)?.status
      return {
        ok: false,
        error:
          status === 404 || status === 403
            ? 'Cannot access this board with the provided token'
            : 'Failed to verify board access',
        status: status || 502,
      }
    }
  }

  return {
    ok: true,
    displayName: me?.displayName || email.split('@')[0],
    accountId: me?.accountId || null,
    email: meEmail || email,
  }
}

/**
 * @param {string} email
 */
export async function boardsForEmail(email) {
  if (!isAllowedEmail(email)) {
    return { error: 'Email must be @truedigital.com or @muze.co.th', status: 400 }
  }

  const user = await findJiraUserByEmail(email)
  if (!user) {
    return { error: 'No Jira user found for this email', status: 404 }
  }

  const [boards, counts] = await Promise.all([
    listAllBoards(),
    assignmentCountsByProject(user.accountId),
  ])

  const enriched = boards.map((board) => ({
    ...board,
    assignedCount: board.projectKey ? counts[board.projectKey] || 0 : 0,
  }))

  enriched.sort((a, b) => {
    if (b.assignedCount !== a.assignedCount) return b.assignedCount - a.assignedCount
    return a.name.localeCompare(b.name)
  })

  const recentAssigned = enriched.filter((b) => b.assignedCount > 0)

  return {
    user,
    boards: enriched,
    lookbackDays: ASSIGNMENT_LOOKBACK_DAYS,
    totals: {
      assignedBoards: recentAssigned.length,
      boardCount: enriched.length,
      assignmentHits: Object.values(counts).reduce((s, n) => s + n, 0),
    },
  }
}
