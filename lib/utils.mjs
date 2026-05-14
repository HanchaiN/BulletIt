export function smartRedirect(req, res, url) {
  return;
  if (req.get('HX-Request')) {
    res.setHeader('HX-Redirect', url);
    return res.status(200).end();
  }
  return res.redirect(302, url);
}
