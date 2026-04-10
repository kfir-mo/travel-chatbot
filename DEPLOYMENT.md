# GitHub & Vercel Deployment Guide

## Step 1: Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. **Repository name**: `travel-chatbot`
3. **Description**: `AI-powered travel booking chatbot for WordPress and standalone deployment`
4. Choose **Public** or **Private** (your preference)
5. **DO NOT** initialize with README, .gitignore, or license (we already have them)
6. Click **Create repository**

## Step 2: Push to GitHub

After creating the repository, GitHub will show you commands. Run these in your terminal:

```bash
cd "d:\projects\personal projects\travel chatbot"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/travel-chatbot.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your actual GitHub username.

**Alternative (if using SSH):**
```bash
git remote add origin git@github.com:YOUR-USERNAME/travel-chatbot.git
git push -u origin main
```

## Step 3: Deploy to Vercel

### Option A: Using Vercel CLI (Recommended)

1. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

2. **Deploy:**
   ```bash
   cd "d:\projects\personal projects\travel chatbot"
   vercel
   ```

3. **Follow the prompts:**
   - Link to your GitHub account (if first time)
   - Select "travel-chatbot" project
   - Choose "Other" for framework
   - Set root directory to `.` (current directory)

4. **Add Environment Variables:**
   - After deployment, go to Vercel Dashboard
   - Select your project
   - Go to **Settings → Environment Variables**
   - Add these variables:
     - `WP_URL`: Your WordPress site URL
     - `WP_USERNAME`: WordPress username
     - `WP_APP_PASSWORD`: WordPress app password
     - `AI_PROVIDER`: `claude` or `openai`
     - `AI_KEY`: Your Claude/OpenAI API key
     - `AI_MODEL`: Your chosen model name

5. **Redeploy:**
   ```bash
   vercel --prod
   ```

### Option B: Using Vercel Dashboard (GitHub Integration)

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **Add New... → Project**
3. Click **Import Git Repository**
4. Search for and select `travel-chatbot`
5. Configure:
   - **Framework Preset**: Other
   - **Root Directory**: `.`
   - **Build Command**: Leave empty
   - **Output Directory**: `.`
6. Click **Deploy**
7. Once deployed, go to **Settings → Environment Variables**
8. Add the same environment variables as listed above
9. **Redeploy** to apply environment variables

## Step 4: Test on Your Phone

After deployment, you'll get a public URL like: `https://travel-chatbot-xxxxx.vercel.app`

1. Open the URL on your phone's browser
2. The chatbot should load and work
3. Share the URL with others to test

## Important Notes

⚠️ **Environment Variables:**
- Never commit `.env` files to GitHub
- Always use `local-test/.env.example` as template
- Set actual keys in Vercel dashboard, not in code

⚠️ **Cost Considerations:**
- Vercel free tier includes generous limits
- API calls to Claude/OpenAI still cost based on usage
- Monitor your API spending!

⚠️ **WordPress Connection:**
- Ensure the `WP_URL` in Vercel is accessible from the internet
- Verify WordPress app password has necessary permissions
- Test locally first with `node local-test/server.js`

## Troubleshooting

**Deploy failed?**
- Check Vercel logs: Dashboard → Project → Deployments → Failed deployment
- Ensure all environment variables are set

**Server shows 502 error?**
- Verify environment variables are set correctly
- Check if WordPress site is accessible
- Review server logs in Vercel dashboard

**Can't access from phone?**
- Check firewall/CORS settings
- Ensure phone is on same network or accessible internet
- Test with: `curl https://your-vercel-url.com`

## Next Steps

After successful deployment:

1. Create `.env` file locally (copy from `.env.example`) for local development
2. Keep pushing changes to GitHub:
   ```bash
   git add .
   git commit -m "Your message"
   git push
   ```
3. Each push to main will auto-deploy on Vercel (if configured)
4. Monitor API usage and adjust settings as needed
