import { Router } from 'express';
import { authorize } from '../middleware/auth.js';

const router = Router();
const GITHUB_OWNER = 'OliwerO';
const GITHUB_REPO = 'flower-studio';

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghFetch(path, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}${path}`,
    { ...rest, headers: { ...githubHeaders(), ...extraHeaders } }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.message || JSON.stringify(body);
    const err = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// All issues routes are owner-only
router.use(authorize('issues'));

// GET /api/issues — list issues
router.get('/', async (req, res) => {
  try {
    const { state = 'open', labels, sort = 'created', direction = 'desc' } = req.query;
    const params = new URLSearchParams({ state, sort, direction, per_page: '100' });
    if (labels) params.set('labels', labels);
    const issues = await ghFetch(`/issues?${params}`);
    res.json(issues);
  } catch (err) {
    console.error('[ISSUES] list error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/issues/labels — all available labels
router.get('/labels', async (req, res) => {
  try {
    const labels = await ghFetch('/labels?per_page=100');
    res.json(labels);
  } catch (err) {
    console.error('[ISSUES] labels error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/issues/:number/comments
router.get('/:number/comments', async (req, res) => {
  try {
    const comments = await ghFetch(`/issues/${req.params.number}/comments?per_page=100`);
    res.json(comments);
  } catch (err) {
    console.error('[ISSUES] comments error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/issues/:number
router.get('/:number', async (req, res) => {
  try {
    const issue = await ghFetch(`/issues/${req.params.number}`);
    res.json(issue);
  } catch (err) {
    console.error('[ISSUES] get error:', err.message);
    res.status(err.status || 404).json({ error: err.message });
  }
});

// POST /api/issues — create new issue
router.post('/', async (req, res) => {
  try {
    const { title, body, labels } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const issue = await ghFetch('/issues', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), body: body || '', labels: labels || [] }),
    });
    res.status(201).json(issue);
  } catch (err) {
    console.error('[ISSUES] create error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/issues/:number/comments — add comment
router.post('/:number/comments', async (req, res) => {
  try {
    const { body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
    const comment = await ghFetch(`/issues/${req.params.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: body.trim() }),
    });
    res.status(201).json(comment);
  } catch (err) {
    console.error('[ISSUES] comment create error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /api/issues/:number — update title, body, state, or labels
router.patch('/:number', async (req, res) => {
  try {
    const { title, body, state, labels } = req.body;
    const payload = {};
    if (title !== undefined) payload.title = title;
    if (body !== undefined) payload.body = body;
    if (state !== undefined) payload.state = state;
    if (labels !== undefined) payload.labels = labels;
    if (!Object.keys(payload).length) return res.status(400).json({ error: 'nothing to update' });
    const issue = await ghFetch(`/issues/${req.params.number}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    res.json(issue);
  } catch (err) {
    console.error('[ISSUES] update error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
