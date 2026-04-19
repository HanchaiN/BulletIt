import express from 'express';

const router = express.Router();

/**
 * GET / - List bullets with optional filter
 * Query params: ?q=active|archive|all (default: active)
 */
router.get('/', function (req, res) {
  const filter = req.query.q ?? 'active';
  const validFilters = ['active', 'archive', 'all'];
  
  if (!validFilters.includes(filter)) {
    const err = new Error('Invalid filter. Valid options are: active, archive, all');
    err.status = 400;
    throw err;
  }
  
  const list = res.app.locals.database.bullet_read(filter);
  res.render('index', { list });
});

/**
 * POST / - Create a new patch (new bullet submission)
 * Body: { content: string }
 */
router.post('/', function (req, res) {
  const { content } = req.body;
  
  if (!content || typeof content !== 'string' || content.trim() === '') {
    const err = new Error('Content is required and must be a non-empty string');
    err.status = 400;
    throw err;
  }
  
  res.app.locals.database.patch_bullet_create(content);
  res.status(202).render('error', { message: `Bullet patch created and pending approval`, error: {} });
});

/**
 * PATCH /:id - Request archive or unarchive
 * Body: { active: '0' (archive) or '1' (unarchive), content: string }
 */
router.patch('/:id', function (req, res) {
  const bulletId = parseInt(req.params.id, 10);
  
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }

  const isActive = req.body.active !== '0';
  try {
    res.app.locals.database.patch_bullet_create_active_change(bulletId, isActive);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') {
      err.status = 404;
    }
    throw err;
  }
  res.status(202).render('error', { message: `Bullet patch created for ${bulletId} and pending approval`, error: {} });
});

/**
 * DELETE /:id - Remove a bullet directly
 */
// router.delete('/:id', function (req, res, next) {
//   const bulletId = parseInt(req.params.id, 10);
  
//   if (isNaN(bulletId)) {
//     const err = new Error('Invalid bullet ID');
//     err.status = 400;
//     throw err;
//   }

//   try {
//     res.app.locals.database.bulletin_delete(req.params.id);
//   } catch (err) {
//     if (err.code === 'DB_NO_CHANGE') {
//       err.status = 404;
//     }
//     throw err;
//   }
//   res.status(200).render('error', { message: 'Bullet deleted successfully', error: {} });
// });

/**
 * GET /:id/history - View change history for a bullet
 */
router.get('/:id/history', function (req, res) {
  const bulletId = parseInt(req.params.id, 10);
  
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  
  const list = res.app.locals.database.patch_bullet_read_by_bulletid(bulletId);
  res.render('history', { list });
});

/**
 * GET /patch - List pending patches for review
 */
router.get('/patch', function (req, res) {
  const list = res.app.locals.database.patch_bullet_read_pending();
  res.render('approval', { list });
});

/**
 * POST /patch/:id/approve - Approve a patch
 * Atomically applies the patch and rejects competing patches
 */
router.post('/patch/:id/approve', function (req, res) {
  const patchId = parseInt(req.params.id, 10);
  
  if (isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }
  
  try {
    res.app.locals.database.patch_bullet_approve(patchId);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') {
      err.status = 409;
    }
    throw err;
  }
  res.status(200).render('error', { message: `Patch ${patchId} approved and applied successfully`, error: {} });
});

/**
 * DELETE /patch/:id - Reject a patch
 */
router.delete('/patch/:id', function (req, res) {
  const patchId = parseInt(req.params.id, 10);
  
  if (isNaN(patchId)) {
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
  res.status(200).render('error', { message: `Patch ${patchId} rejected successfully`, error: {} });
});

export default router;
