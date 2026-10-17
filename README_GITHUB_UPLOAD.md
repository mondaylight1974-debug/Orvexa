# Orvexa AI — GitHub Upload Package

This is the current Orvexa AI starter package. It preserves the existing dark interface and includes the web app and Supabase function starter files. It is NOT yet a fully deployed or production-ready AI app.

## Upload to GitHub from Android
1. Extract this ZIP on your phone.
2. Open your `Smartt` repository on GitHub.
3. Choose **Add file → Upload files**.
4. Upload the files and folders inside this extracted folder (not just the ZIP). Keep `index.html` at the repository root.
5. Commit the upload.

## Important
- Do not upload passwords, private database credentials, service-role keys, or AI provider secrets.
- The Supabase URL and publishable key in `index.html` are browser-side settings; use only a publishable/anon key with correct Row Level Security policies.
- The app's AI endpoints require backend deployment and a supported provider key. This package does not make paid API access free and does not include a built APK.
- Do not run `supabase/schema.sql` again if you already created your tables; it may create duplicate/conflicting objects.
- Before making the repository public, review all files for any private credentials.

See the original setup notes below for backend configuration details.
