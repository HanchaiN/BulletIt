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
 * POST / - Create a new bullet directly
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
  
  res.app.locals.database.bulletin_create(content);
  res.redirect(303, '/');
});

/**
 * PATCH /:id - Archive or unarchive a bullet directly
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
  res.app.locals.database.bulletin_update_active(bulletId, isActive);
  res.redirect(303, '/');
});

export default router;

/**
 * DELETE /:id - Remove a bullet directly
 */
router.delete('/:id', function (req, res, next) {
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

  res.app.locals.database.bulletin_delete(req.params.id);

  return res.redirect(303, '/');
});
