Monsey Trails – Service Log (v2.2.1a Users Fix)

What’s new
- Users tab permanently shows all users with Rename / Reset PIN / Remove
- Soft auto-seed: if DB has no admins, seeds Admin 1/2/3 (PINs 9991/9992/9993) and 16 mechanics
- Keeps your existing logo path (public/logo.png). If you already have a logo in your repo, keep it; this ZIP won’t overwrite it.

Run locally
  npm install
  node server.js

Deploy (Render)
  Build: npm install
  Start: node server.js
  (Optional) Env: DB_FILE=data_v221a.sqlite to start with a fresh DB
