# Google sign-in setup (one time, ~15 minutes)

Deercast uses Streamlit's built-in Google sign-in (`st.login`). Google only confirms who someone is. The app's own
user list (**Grounds → 👥 App users**) decides who gets in.

## 1. Google side (console.cloud.google.com, on a Mac or PC)
1. Create a project, for example *Deercast*, and make sure it's **selected** in the project picker at the top left.
   Then open **☰ → APIs & Services → OAuth consent screen** (or search "Google Auth Platform"). On a new project it
   says *"Google Auth Platform not configured yet"*. Click **Get started** and fill in the wizard: app name
   *Deercast*, your Gmail as support email, Audience **External**, your email as contact, agree, **Create**. Only
   after that does the left menu show **Branding, Audience, Clients**.
2. **Branding:** set the app name to *Deercast* and use your Gmail as the support email. Save.
3. **Audience:** while the app is in *Testing*, add the Google emails that will sign in (yours and Matt's) under
   **Test users**. Later you can click **Publish app**, so anyone you add in Deercast can sign in without also being
   added here. The app only asks for basic profile and email, so publishing doesn't need Google review.
4. **Clients → Create client → Web application**, name *Deercast*.
   - **Authorized redirect URIs:** `https://YOUR-APP.streamlit.app/oauth2callback`
     (your app's address, exactly, plus `/oauth2callback`)
   - Create, then copy the **Client ID** and **Client secret**.

## 2. Streamlit side (share.streamlit.io → your app → Settings → Secrets)
Add the following, keeping your existing `[storage]` section. Plain keys must come *before* any `[section]`.

```toml
ADMIN_EMAIL = "your-gmail@gmail.com"

[auth]
redirect_uri = "https://YOUR-APP.streamlit.app/oauth2callback"
cookie_secret = "any-long-random-string"   # make your own — never reuse one from a public page
client_id = "....apps.googleusercontent.com"
client_secret = "GOCSPX-...."
server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"
```

Save. The app restarts automatically.

## 3. First sign-in
- Open the app and tap **Sign in with Google**, using the ADMIN_EMAIL account.
- Your existing stands, bait, marks and hunts are already in **Lewis/Klein Property**. If they were created under the
  password login, they move to your Google account automatically on this first sign-in.
- **Grounds → 👥 App users:** add Matt's Google email and name, and leave "Also add to Lewis/Klein Property" checked.
- Matt opens the app link and signs in with Google.

Once Google sign-in works, you can delete `APP_PASSWORD`. It's ignored once `[auth]` is set.
