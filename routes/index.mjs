import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authMiddleware from '../lib/middleware/auth.mjs';
import { smartRedirect } from '../lib/utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../public/uploads'),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/\s+/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.pdf', '.mp4', '.mov'];
    
    // Accept if either the MIME type matches OR the extension matches
    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, PDF, MP4, and MOV files are allowed'));
    }
  }
});

const router = express.Router();

/**
 * GET / - Homepage
 */
router.get('/', (req, res) => {
  res.status(302).redirect('/bullet');
});

/**
 * GET /bullet - List bullets
 */
router.get('/bullet', (req, res) => {
  const list = res.app.locals.database.bullet_read();
  res.render('bullet/list', { list });
});

/**
 * POST /bullet/search - Lookup page
 * Body: { searchterm: string, active: boolean, archive: boolean }
 */
router.post('/bullet/search', (req, res) => {
  const list = res.app.locals.database.bullet_search({
    searchterm: req.body.searchterm, // TODO: parse searchterm
    active: req.body.active === 'on',
    archive: req.body.archive === 'on',
  });
  res.render('bullet/list', { list });
});


/**
 * GET /bullet/create - Dedicated create page
 */
router.get('/bullet/create', (req, res) => {
  res.render('bullet/create');
});

/**
 * POST /bullet - Create new bullet
 */
router.post('/bullet', upload.single('image'), (req, res) => {
  const patch = {
    title: req.body.title ? req.body.title.trim() : null,
    content: req.body.content ?? null,
    image_uri: req.file ? `/uploads/${req.file.filename}` : null,
    is_active: (req.body.active ?? null) === null ? null : req.body.active !== '0',
    expire_at: req.body.expire_at ? (Date.parse(req.body.expire_at) / 1000 || null) : null,
    active_at: req.body.active_at ? (Date.parse(req.body.active_at) / 1000 || null) : null,
  }
  if (!patch.content || typeof patch.content !== 'string' || patch.content.trim() === '') {
    const err = new Error('Content is required');
    err.status = 400;
    throw err;
  }
  
  let patchId;
  try {
    patchId = res.app.locals.database.patch_bullet_create_create(patch);
  } catch (err) {
    throw err;
  }
  res.status(202).render('error', { message: `Bullet patch ${patchId} created and pending approval`, error: {} });
  return smartRedirect(req, res, '/?success=patch_created');
});

/**
 * GET /bullet/:id - Dedicated view page
 */
router.get('/bullet/:id', (req, res) => {
  const bulletId = Number.parseInt(req.params.id, 10);
  
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  
  const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    const err = new Error('Bullet not found');
    err.status = 404;
    throw err;
  }
  const history = res.app.locals.database.patch_bullet_read_by_bulletid(bulletId);
  res.render('bullet/read', { bullet, history });
});

/**
 * GET /bullet/:id/edit - Dedicated edit page
 */
router.get('/bullet/:id/edit', (req, res) => {
  const bulletId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    const err = new Error('Bullet not found');
    err.status = 404;
    throw err;
  }
  res.render('bullet/update', { bullet });
});


/**
 * POST /:id - Update bullet (archive, content, or image)
 */
router.post('/bullet/:id', upload.single('image'), (req, res) => {
  const bulletId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  
  // Safely handle missing checkboxes from standard forms
  const patch = {
    title: req.body.title ? req.body.title.trim() : null,
    content: req.body.content ?? null,
    image_uri: req.file ? `/uploads/${req.file.filename}` : null,
    is_active: typeof req.body.active === 'undefined' ? null : (req.body.active === 'on' || req.body.active === 'true' || req.body.active === '1'),
    expire_at: req.body.expire_at ? (Date.parse(req.body.expire_at) / 1000 || null) : null,
    active_at: req.body.active_at ? (Date.parse(req.body.active_at) / 1000 || null) : null,
  }
  if (Object.entries(patch).every(([_, v]) => v === null)) {
    const err = new Error('Provide any of the fields');
    err.status = 400;
    throw err;
  }
  
  let patchId;
  try {
    patchId = res.app.locals.database.patch_bullet_create_update(bulletId, patch);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 404;
    throw err;
  }

  res.status(202).render('error', { message: `Bullet patch ${patchId} created for ${bulletId} and pending approval`, error: {} });
  return smartRedirect(req, res, '/?success=patch_created');
});


/**
 * POST /bullet/:id/archive - Create archive patch request
 */
router.post('/bullet/:id/archive', (req, res) => {
  const bulletId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  // Get current bullet state
  const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    const err = new Error('Bullet not found');
    err.status = 404;
    throw err;
  }

  res.status(202).render('error', { message: `Bullet patch ${patchId} created for ${bulletId} and pending approval`, error: {} });
  return smartRedirect(req, res, '/?toast=archived');
});

/**
 * POST /bullet/:id/revive - Create revive patch request
 */
router.post('/bullet/:id/revive', (req, res) => {
  const bulletId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  const bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    const err = new Error('Bullet not found');
    err.status = 404;
    throw err;
  }
  res.status(202).render('error', { message: `Bullet patch ${patchId} created for ${bulletId} and pending approval`, error: {} });
  return smartRedirect(req, res, '/?toast=revived');
});

/**
 * DELETE /bullet/:id - Remove bullet
 */
router.delete('/bullet/:id', authMiddleware, (req, res) => {
  const bulletId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(bulletId)) {
    const err = new Error('Invalid bullet ID');
    err.status = 400;
    throw err;
  }
  try {
    res.app.locals.database.unsafe__bullet_delete(req.params.id);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 404;
    throw err;
  }
  res.status(200).render('error', { message: `Bullet ${patchId} deleted permanently`, error: {} });
  return smartRedirect(req, res, '/?toast=archived');
});

/**
 * GET /patch - Pending patches for review
 */
router.get('/patch', authMiddleware, (req, res) => {
  const list = res.app.locals.database.patch_bullet_read_pending_group();
  
  res.render('patch/list', { list });
});

/**
 * GET /patch/:id - View a dedicated side-by-side diff for a specific patch
 */
router.get('/patch/:id', authMiddleware, (req, res) => {
  const patchId = Number.parseInt(req.params.id, 10);

  if (Number.isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }

  const patch = res.app.locals.database.patch_bullet_read_by_id(patchId);
  if (!patch) {
    const err = new Error('Patch not found');
    err.status = 404;
    throw err;
  }

  const bullet = typeof patch.bullet_id === 'number' ? res.app.locals.database.bullet_read_by_id(patch.bullet_id) : null;

  res.render('patch/read', { bullet, patch });
});

/**
 * POST /patch/:id/approve - Approve a patch
 * Atomically applies the patch and rejects competing patches
 */
router.post('/patch/:id/approve', authMiddleware, (req, res) => {
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
    if (err.code === 'DB_NO_CHANGE') err.status = 409;
    throw err;
  }
  res.status(202).render('error', { message: `Bullet patch ${patchId} approved successfully`, error: {} });
  return smartRedirect(req, res, '/patch?toast=approved');
});

/**
 * POST /patch/:id/reject - Reject patch
 */
router.post('/patch/:id/reject', authMiddleware, (req, res) => {
  const patchId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }
  try {
    res.app.locals.database.patch_bullet_reject(patchId);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 409;
    throw err;
  }
  res.status(202).render('error', { message: `Bullet patch ${patchId} rejected successfully`, error: {} });
  return smartRedirect(req, res, '/patch?toast=rejected');
});

export default router;
