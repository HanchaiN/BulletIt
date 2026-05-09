import express from 'express';
import authMiddleware from '../lib/middleware/auth.mjs';

const router = express.Router();

/**
 * GET / - List bullets
 */
router.get('/', function (req, res) {
  const list = res.app.locals.database.bullet_read();
  res.render('index', { list });
});

/**
 * POST / - Create a new patch (new bullet submission)
 * Body: { content: string }
 */
router.post('/', function (req, res) {
  const patch = {
    content: req.body.content ?? null,
    is_active: (req.body.active ?? null) === null ? null : req.body.active !== '0',
    expire_at: req.body.expire_at ? (Date.parse(req.body.expire_at) / 1000 || null) : null,
    active_at: req.body.active_at ? (Date.parse(req.body.active_at) / 1000 || null) : null,
  }
  if (!patch.content || typeof patch.content !== 'string' || patch.content.trim() === '') {
    const err = new Error('Content is required and must be a non-empty string');
    err.status = 400;
    throw err;
  }
  const patchId = res.app.locals.database.patch_bullet_create_create(patch);
  res.status(202).render('error', { message: `Bullet patch ${patchId} created and pending approval`, error: {} });
});

/**
 * POST / - Create a new patch (new bullet submission)
 * Body: { searchterm: string, active: boolean, archive: boolean }
 */
router.post('/search', function (req, res) {
  const { searchterm, active, archive } = req.body;
  // TODO: parse searchterm

  const list = res.app.locals.database.bullet_search({
    searchterm,
    active: active === 'on',
    archive: archive === 'on',
  });
  res.render('index', { list });
});

/**
 * PATCH /:id - Request archive or unarchive
 * Body: { active: '0' (archive) or '1' (unarchive), content: string }
 */
router.patch('/:id', function (req, res) {
  const bulletId = Number.parseInt(req.params.id, 10);
  
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }

  let patchId;
  const patch = {
    content: req.body.content ?? null,
    is_active: (req.body.active ?? null) === null ? null : req.body.active !== '0',
    expire_at: req.body.expire_at ? (Date.parse(req.body.expire_at) / 1000 || null) : null,
    active_at: req.body.active_at ? (Date.parse(req.body.active_at) / 1000 || null) : null,
  }
  try {
    patchId = res.app.locals.database.patch_bullet_create_update(bulletId, patch);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') {
      err.status = 404;
    }
    throw err;
  }
  res.status(202).render('error', { message: `Bullet patch ${patchId} created for ${bulletId} and pending approval`, error: {} });
});

/**
 * DELETE /:id - Remove a bullet directly
 */
router.delete('/:id', authMiddleware, function (req, res, next) {
  const bulletId = Number.parseInt(req.params.id, 10);
  
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }

  try {
    res.app.locals.database.bulletin_delete(req.params.id);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') {
      err.status = 404;
    }
    throw err;
  }
  res.status(200).render('error', { message: `Bullet ${bulletId} deleted successfully`, error: {} });
});

/**
 * GET /:id/detail - View detail of a bullet
 */
router.get('/:id/detail', function (req, res) {
  const bulletId = Number.parseInt(req.params.id, 10);
  
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  
  const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  const history = res.app.locals.database.patch_bullet_read_by_bulletid(bulletId);
  res.render('detail', { bullet, history });
});

/**
 * GET /patch - List pending patches for review
 */
router.get('/patch', function (req, res) {
  const list = res.app.locals.database.patch_bullet_read_pending_group();
  res.render('approval', { list });
});

/**
 * POST /patch/:id/approve - Approve a patch
 * Atomically applies the patch and rejects competing patches
 */
router.post('/patch/:id/approve', authMiddleware, function (req, res) {
  const patchId = Number.parseInt(req.params.id, 10);
  
  if (Number.isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }
  
  let bulletId;
  try {
    bulletId = res.app.locals.database.patch_bullet_approve(patchId);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') {
      err.status = 409;
    }
    throw err;
  }
  res.setHeader('HX-Trigger', JSON.stringify({ refreshPatch: patchId, refreshBullet: true }));
  res.status(200).render('error', { message: `Patch ${patchId} approved and applied to bullet ${bulletId} successfully`, error: {} });
});

/**
 * DELETE /patch/:id - Reject a patch
 */
router.delete('/patch/:id', authMiddleware, function (req, res) {
  const patchId = Number.parseInt(req.params.id, 10);
  
  if (Number.isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }
  
  try {
    res.app.locals.database.patch_bullet_reject(patchId);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') {
      err.status = 409;
    }
    throw err;
  }
  res.setHeader('HX-Trigger', JSON.stringify({ refreshPatch: patchId }));
  res.status(200).render('error', { message: `Patch ${patchId} rejected successfully`, error: {} });
});

export default router;
