# 🚀 Deployment Guide

## Quick Deploy Options

### 1. GitHub Pages (Recommended - Free & Easy)

**Automatic deployment with GitHub Actions:**

1. **Push your code:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/dioptre/whisper_trigger.git
   git push -u origin main
   ```

2. **Enable GitHub Pages:**
   - Go to: `Settings` → `Pages`
   - Source: `GitHub Actions`
   - Click `Save`

3. **Wait for deployment:**
   - Check the `Actions` tab
   - First deployment takes ~2 minutes
   - Your site: `https://dioptre.github.io/whisper_trigger/`

**Manual deployment:**

```bash
# Build
npm run build

# Deploy to gh-pages branch
npm install -D gh-pages
npx gh-pages -d dist
```

Then enable GitHub Pages with source: `gh-pages` branch.

### 2. Netlify (1-Click Deploy)

**Option A: Drag & Drop**
1. Run `npm run build`
2. Go to [netlify.com/drop](https://app.netlify.com/drop)
3. Drag the `dist/` folder
4. Done! Get instant URL

**Option B: Git Integration**
1. Connect your GitHub repo at [netlify.com](https://app.netlify.com/)
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Click `Deploy`

**Environment Variables:**
- Add `VITE_GROQ_API_KEY` in Netlify dashboard
- Or users enter it manually in the UI

### 3. Vercel (1-Click Deploy)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/whisper_trigger)

**Or manually:**

```bash
npm install -g vercel
vercel
```

Follow the prompts. Vercel auto-detects Vite projects.

### 4. Cloudflare Pages

1. Go to [Cloudflare Pages](https://pages.cloudflare.com/)
2. Connect your Git repo
3. Build command: `npm run build`
4. Build output: `dist`
5. Deploy!

**Benefits:**
- Free SSL
- Global CDN
- Fast edge network

### 5. Custom Static Host

**Build:**
```bash
npm run build
```

**Upload `dist/` to:**
- AWS S3 + CloudFront
- Google Cloud Storage
- Azure Static Web Apps
- Any web server (Apache, Nginx, etc.)

**Nginx example config:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/whisper_trigger/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Post-Deployment Setup

### 1. Update Links in README

Replace `yourusername` with your actual GitHub username:
```bash
sed -i 's/yourusername/ACTUAL_USERNAME/g' README.md
```

### 2. Add Custom Domain (Optional)

**GitHub Pages:**
- Settings → Pages → Custom domain
- Add CNAME record: `yourdomain.com` → `yourusername.github.io`

**Netlify/Vercel:**
- Dashboard → Domain Settings
- Add your domain
- Update DNS records

### 3. Enable HTTPS

All platforms above provide **free SSL** automatically via Let's Encrypt.

## Environment Variables

### For Build-Time Variables

Create `.env` (gitignored):
```bash
VITE_GROQ_API_KEY=your_key_here
```

Or set in hosting platform:
- **Netlify**: Site Settings → Environment Variables
- **Vercel**: Project Settings → Environment Variables
- **GitHub Actions**: Repo Settings → Secrets

### For User-Provided Keys

Leave `.env` blank and users enter keys in the UI (current setup).

## Troubleshooting

### "Failed to fetch" errors

**CORS issue**: Groq API should support CORS, but if you get errors:
- Check browser console for details
- Verify API key is correct
- Try from different browser/device

### Assets not loading

**Wrong base path**:
- Verify `vite.config.js` has `base: './'`
- Or set to your repo name: `base: '/whisper_trigger/'`

### Microphone access denied

**HTTPS required:**
- Modern browsers require HTTPS for microphone access
- All deploy platforms above provide free SSL
- For local testing, use `localhost` (HTTP allowed)

### Build fails

**Missing dependencies:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Performance Optimization

### Enable Compression

Most hosting platforms do this automatically. For custom servers:

**Nginx:**
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
```

**Apache:**
```apache
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/css application/javascript
</IfModule>
```

### Add Caching Headers

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## Monitoring

### Analytics Options

Add to `index.html`:

**Google Analytics:**
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
```

**Plausible (Privacy-friendly):**
```html
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>
```

### Error Tracking

**Sentry:**
```bash
npm install @sentry/browser
```

Add to `main.js`:
```javascript
import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "your-dsn",
  environment: "production"
});
```

## Cost Estimates

### Hosting: **FREE**
- GitHub Pages: Free
- Netlify: 100GB bandwidth/month free
- Vercel: 100GB bandwidth/month free
- Cloudflare Pages: Unlimited bandwidth free

### Groq API:
- **Free tier**: Very generous
- **Paid**: ~$0.11 per hour of audio
- **Your usage**: ~1-2 second clips = ~$0.0001 per transcription

**Example:** 1000 transcriptions/month = ~$0.10

## Security Checklist

- [ ] `.env` is in `.gitignore`
- [ ] API key not hardcoded in source
- [ ] HTTPS enabled (SSL certificate)
- [ ] CORS policy understood
- [ ] Rate limiting considered (Groq's side)
- [ ] User API key option available
- [ ] Spending limits set in Groq dashboard

## Next Steps

After deploying:

1. **Test on mobile devices**
2. **Share the demo link**
3. **Gather user feedback**
4. **Monitor API usage**
5. **Iterate and improve**

Happy deploying! 🚀
