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
    return res.redirect(303, '/');
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
    res.status(400);
    res.locals.message = 'Content is required and must be a non-empty string';
    res.locals.error = {};
    return res.render('error');
  }
  
  res.app.locals.database.patch_bullet_create(content);
  res.redirect(303, '/');
});

/**
 * PATCH /:id - Request archive or unarchive
 * Body: { active: '0' (archive) or '1' (unarchive) }
 */
router.patch('/:id', function (req, res) {
  const bulletId = parseInt(req.params.id, 10);
  
  if (isNaN(bulletId)) {
    res.status(400);
    res.locals.message = 'Invalid bullet ID';
    res.locals.error = {};
    return res.render('error');
  }
  
  const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    res.status(404);
    res.locals.message = 'Bullet not found';
    res.locals.error = {};
    return res.render('error');
  }
  
  const isActive = req.body.active !== '0';
  res.app.locals.database.patch_bullet_create_active_change(bulletId, isActive);
  res.redirect(303, '/');
});

/**
 * DELETE /:id - Remove a bullet directly
 */
// router.delete('/:id', function (req, res, next) {
//   const bulletId = parseInt(req.params.id, 10);
  
//   if (isNaN(bulletId)) {
//     res.status(400);
//     res.locals.message = 'Invalid bullet ID';
//     res.locals.error = {};
//     return res.render('error');
//   }

//   const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
//   if (!bullet) {
//     res.status(404);
//     res.locals.message = 'Bullet not found';
//     res.locals.error = {};
//     return res.render('error');
//   }

//   res.app.locals.database.bulletin_delete(req.params.id);

//   return res.redirect(303, '/');
// });

/**
 * GET /:id/history - View change history for a bullet
 */
router.get('/:id/history', function (req, res) {
  const bulletId = parseInt(req.params.id, 10);
  
  if (isNaN(bulletId)) {
    res.status(400);
    res.locals.message = 'Invalid bullet ID';
    res.locals.error = {};
    return res.render('error');
  }
  
  const list = res.app.locals.database.bullet_read_history(bulletId);
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
    res.status(400);
    res.locals.message = 'Invalid patch ID';
    res.locals.error = {};
    return res.render('error');
  }
  
  res.app.locals.database.patch_bullet_approve(patchId);
  res.redirect(303, '/patch');
});

/**
 * DELETE /patch/:id - Reject a patch
 */
router.delete('/patch/:id', function (req, res) {
  const patchId = parseInt(req.params.id, 10);
  
  if (isNaN(patchId)) {
    res.status(400);
    res.locals.message = 'Invalid patch ID';
    res.locals.error = {};
    return res.render('error');
  }
  
  res.app.locals.database.patch_bullet_reject(patchId);
  res.redirect(303, '/patch');
});

export default router;
