import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authMiddleware from '../lib/middleware/auth.mjs';

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

// Smart Redirect: Handles both HTMX and Standard HTML form submissions gracefully
function smartRedirect(req, res, url) {
  if (req.get('HX-Request')) {
    res.setHeader('HX-Redirect', url);
    return res.status(200).end();
  }
  return res.redirect(302, url);
}

function addImageUrl(item) {
  if (!item) return item;

  // Safely grab the path whether the DB returned it as image_path or image_url
  const rawPath = item.image_path || item.image_url;
  let ext = null;

  if (rawPath) {
    ext = rawPath.split('.').pop().toLowerCase();
  }

  return {
    ...item,
    // Force absolute pathing with exactly one leading slash
    image_url: rawPath ? '/' + rawPath.replace(/^\/+/, '') : null,
    media_ext: ext
  };
}

function addImageUrls(list) {
  return Array.isArray(list) ? list.map(addImageUrl) : list;
}

/**
 * GET / - List bullets with optional filter
 * Query params: ?q=active|archive|all (default: active)
 */
router.get('/', (req, res) => {
  const filter = req.query.q ?? 'active';
  if (!['active', 'archive', 'all'].includes(filter)) {
    const err = new Error('Invalid filter');
    err.status = 400;
    throw err;
  }
  const list = addImageUrls(res.app.locals.database.bullet_read(filter));
  res.render('index', { list, filter });
});

/**
 * POST / - Create new bulletin
 */
router.post('/', upload.single('image'), (req, res) => {
  const title = req.body.title ? req.body.title.trim() : null;
  const rawContent = req.body.content ?? '';
  const content = typeof rawContent === 'string' ? rawContent.trim() : '';
  if (!content || content.toLowerCase() === 'null') {
    const err = new Error('Content is required');
    err.status = 400;
    throw err;
  }
  const imagePath = req.file ? `uploads/${req.file.filename}` : null;
  try {
    res.app.locals.database.patch_bullet_create(title, content, imagePath);
  } catch (err) {
    return smartRedirect(req, res, '/?toast=error');
  }
  return smartRedirect(req, res, '/?success=patch_created');
});

/**
 * GET /bullet/new - Dedicated create page
 */
router.get('/bullet/new', (req, res) => {
  res.render('create');
});

/**
 * GET /bullet/:id/edit - Dedicated edit page
 */
router.get('/bullet/:id/edit', (req, res, next) => {
  const bulletId = parseInt(req.params.id, 10);
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bulletin ID');
    err.status = 400;
    return next(err);
  }
  let bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    const err = new Error('Bulletin not found');
    err.status = 404;
    return next(err);
  }
  bullet = addImageUrl(bullet);
  res.render('edit', { bullet });
});

/**
 * GET /bullet/:id - Dedicated view page
 */
router.get('/bullet/:id', (req, res, next) => {
  const bulletId = parseInt(req.params.id, 10);
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bulletin ID');
    err.status = 400;
    return next(err);
  }
  let bullet = res.app.locals.database.bullet_read_by_id(bulletId);
  if (!bullet) {
    const err = new Error('Bulletin not found');
    err.status = 404;
    return next(err);
  }
  bullet = addImageUrl(bullet);
  res.render('view', { bullet });
});

/**
 * POST /bulletins/:id/archive - Create archive patch request
 */
router.post('/bulletins/:id/archive', (req, res) => {
  try {
    const bulletId = parseInt(req.params.id, 10);
    if (isNaN(bulletId)) {
      const err = new Error('Invalid bulletin ID');
      err.status = 400;
      throw err;
    }
    // Get current bulletin state
    const bulletin = res.app.locals.database.bullet_read_by_id(bulletId);
    if (!bulletin) {
      const err = new Error('Bulletin not found');
      err.status = 404;
      throw err;
    }
    // Create patch for toggling active status
    return smartRedirect(req, res, '/?toast=archived');
  } catch (err) {
    return smartRedirect(req, res, '/?toast=error');
  }
});

/**
 * POST /bulletins/:id/revive - Create revive patch request
 */
router.post('/bulletins/:id/revive', (req, res) => {
  try {
    const bulletId = parseInt(req.params.id, 10);
    if (isNaN(bulletId)) {
      const err = new Error('Invalid bulletin ID');
      err.status = 400;
      throw err;
    }
    const bulletin = res.app.locals.database.bullet_read_by_id(bulletId);
    if (!bulletin) {
      const err = new Error('Bulletin not found');
      err.status = 404;
      throw err;
    }
    return smartRedirect(req, res, '/?toast=revived');
  } catch (err) {
    return smartRedirect(req, res, '/?toast=error');
  }
});

/**
 * POST /:id - Update bulletin (archive, content, or image)
 */
router.post('/:id', upload.single('image'), (req, res) => {
  const bulletId = parseInt(req.params.id, 10);
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bulletin ID');
    err.status = 400;
    throw err;
  }
  
  // Safely handle missing checkboxes from standard forms
  const isActive = req.body.active === undefined ? null : (req.body.active === 'on' || req.body.active === 'true' || req.body.active === '1');
  const title = req.body.title ? req.body.title.trim() : null;
  const rawContent = req.body.content ?? null;
  const trimmedContent = typeof rawContent === 'string' ? rawContent.trim() : rawContent;
  const content = trimmedContent === 'null' || trimmedContent === '' ? null : trimmedContent;
  const imagePath = req.file ? `uploads/${req.file.filename}` : null;
  
  if (isActive === null && content === null && imagePath === null && title === null) {
    const err = new Error('Provide active, title, content, or image');
    err.status = 400;
    throw err;
  }
  
  try {
    if (content === null && imagePath === null && title === null) {
      res.app.locals.database.patch_bullet_create_active_change(bulletId, isActive);
    } else {
      res.app.locals.database.patch_bullet_update(bulletId, title, content, imagePath, isActive);
    }
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 404;
    return smartRedirect(req, res, '/?toast=error');
  }
  
  return smartRedirect(req, res, '/?success=patch_created');
});

/**
 * DELETE /:id - Remove bulletin
 */
router.delete('/:id', authMiddleware, (req, res) => {
  const bulletId = parseInt(req.params.id, 10);
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bulletin ID');
    err.status = 400;
    throw err;
  }
  try {
    res.app.locals.database.bulletin_delete(req.params.id);
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 404;
    return smartRedirect(req, res, '/?toast=error');
  }
  return smartRedirect(req, res, '/?toast=archived');
});

/**
 * GET /:id/history - Bulletin history
 */
router.get('/:id/history', (req, res) => {
  const bulletId = parseInt(req.params.id, 10);
  if (isNaN(bulletId)) {
    const err = new Error('Invalid bulletin ID');
    err.status = 400;
    throw err;
  }
  const list = res.app.locals.database.patch_bullet_read_by_bulletid(bulletId);
  const formattedList = addImageUrls(list);
  res.render('history', { list: formattedList });
});

/**
 * GET /patch - Pending patches for review
 */
router.get('/patch', authMiddleware, (req, res) => {
  const list = res.app.locals.database.patch_bullet_read_pending_group();
  
  const processedList = list.map(bullet => {
    const processedBullet = addImageUrl(bullet);
    
    // CRITICAL FIX: SQLite returns json_group_array as a string. Parse it!
    if (typeof processedBullet.patches === 'string') {
      try {
        processedBullet.patches = JSON.parse(processedBullet.patches);
      } catch (e) {
        processedBullet.patches = [];
      }
    }
    
    // Now it is safe to map over the array
    if (processedBullet.patches && Array.isArray(processedBullet.patches)) {
      processedBullet.patches = processedBullet.patches.map(addImageUrl);
    } else {
      processedBullet.patches = [];
    }
    
    return processedBullet;
  });
  
  res.render('approval', { list: processedList });
});

/**
 * GET /patch/:patchId - View a dedicated side-by-side diff for a specific patch
 */
router.get('/patch/:patchId', authMiddleware, (req, res) => {
  const patchId = parseInt(req.params.patchId, 10);
  const list = res.app.locals.database.patch_bullet_read_pending_group() || [];
  
  let foundBullet = null;
  let foundPatch = null;

  for (const bullet of list) {
    // CRITICAL FIX: Skip null or malformed database rows
    if (!bullet || !bullet.patches) continue;

    let patchesArray = bullet.patches;
    
    // Parse the SQLite JSON string safely
    if (typeof patchesArray === 'string') {
      try { 
        patchesArray = JSON.parse(patchesArray); 
      } catch (e) { 
        patchesArray = []; 
      }
    }

    if (Array.isArray(patchesArray)) {
      const patch = patchesArray.find(p => p.id === patchId);
      if (patch) {
        foundBullet = addImageUrl(bullet);
        foundPatch = addImageUrl(patch);
        break;
      }
    }
  }

  if (!foundPatch) {
    return smartRedirect(req, res, '/patch?toast=error');
  }

  res.render('patch_detail', { bullet: foundBullet, patch: foundPatch });
});

/**
 * POST /patch/:id/approve - Approve patch
 */
router.post('/patch/:id/approve', authMiddleware, (req, res) => {
  const patchId = parseInt(req.params.id, 10);
  if (isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }
  try {
    res.app.locals.database.patch_bullet_approve(patchId);
    return smartRedirect(req, res, '/patch?toast=approved');
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 409;
    return smartRedirect(req, res, '/patch?toast=error');
  }
});

/**
 * POST /patch/:id/reject - Reject patch
 */
router.post('/patch/:id/reject', authMiddleware, (req, res) => {
  const patchId = parseInt(req.params.id, 10);
  if (isNaN(patchId)) {
    const err = new Error('Invalid patch ID');
    err.status = 400;
    throw err;
  }
  try {
    res.app.locals.database.patch_bullet_reject(patchId);
    return smartRedirect(req, res, '/patch?toast=rejected');
  } catch (err) {
    if (err.code === 'DB_NO_CHANGE') err.status = 409;
    return smartRedirect(req, res, '/patch?toast=error');
  }
});

export default router;
