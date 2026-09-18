# Setting up Byline without a terminal

This is the whole process, click by click. Budget twenty minutes the first time.

You need two accounts: [GitHub](https://github.com/signup) (free; it's where your files live) and [Vercel](https://vercel.com/signup) (free; it's what puts them on the internet). If you don't have GitHub yet, make it first; Vercel will ask to connect to it during step 1. A third, [Resend](https://resend.com), is only needed if you want an email when the document is opened, and is covered in step 4.

One word you'll see a lot: **deploy** means "put the current files on the live site."

## First: the one thing that can go wrong

Everything in this project protects the **deployed site**. None of it protects the **repository** your file sits in. Those are two different places on the internet. If your repository is public, your document can be downloaded straight from `raw.githubusercontent.com` by anyone who guesses the address, with no key, no stamp, no crawler blocking and no notification.

The order is: deploy, confirm the repository is private, then add your document. Never the other way round. Steps 1 and 2 below handle the private part, and it's the only thing that's genuinely important to get right.

## The steps

**1. Deploy.** Click this button:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/LFGAmy/byline)

Vercel asks you to connect GitHub (say yes), then asks for a name for the project; `byline` is fine. Next to the repository name there's a small padlock. Make sure it's closed, so the field reads **Private Repository Name**; if it reads **Public**, click the padlock. Then click **Create**. It makes a copy of this project in your GitHub and puts it live. What's live at this point is a short demo page about Byline; nothing of yours yet. When it finishes, the page shows your new site's address, something like `byline-abc123.vercel.app`, and a link to the GitHub repository it created. **Copy the site address somewhere;** you'll need it in step 6. The repository's address is `github.com/YOUR-USERNAME/byline`.

**2. Check the repository is private.** Open the GitHub link, the one that looks like `github.com/YOUR-USERNAME/byline`, not the site address. The word **Private** should appear in a small grey label next to the repository name at the top of the page. If it does, skip to step 3.

If it says **Public**, the padlock was open. Fix it now:

- Click the **Settings** tab, along the top of the repository, on the right.
- Scroll all the way to the bottom, to the red box titled **Danger Zone**.
- Click **Change repository visibility**, then **Change visibility**, then **Make private**.
- GitHub shows warnings and asks you to type the repository name to confirm. The warnings are normal. Type it and confirm.

To check: the word **Private** now appears next to the repository name. For a second opinion, open the repository's address in a private browsing window. If it asks you to sign in or says "not found", it's private. Vercel keeps working exactly the same.

**3. Add your document.** Click the **Code** tab, top left, to get back to the file list. Two paths.

*If you have a PDF, which is most people:* first, on your own computer, rename the file to `document`. Not `Acme_Proposal_v3.pdf`, and not `document.pdf` either if you're on a Mac, because Macs usually hide the `.pdf` part and you'd end up with `document.pdf.pdf`. Just `document`; the `.pdf` is already there whether you can see it or not.

Then click **Add file**, then **Upload files**, drag it in, ignore the message box, leave **Commit directly to the main branch** selected, and click **Commit changes**. "Commit" is GitHub's word for save.

Check the file list: it must say exactly `document.pdf`. If it says anything else, click the file, click the trash icon, commit, and try the upload again.

*If you have an HTML page:* open `index.html`, click the pencil icon, and replace everything **above** the comment that says `Byline watermark. Keep these two lines`. Leave those two lines in. Commit.

If you don't have an HTML page and aren't sure what one is, use the PDF path.

Uploading a file redeploys the site on its own. Nothing else to do for this step.

**4. Put your name on it.** In Vercel, open your project, then **Settings** (top), then **Environment Variables** (left). Click **Add**:

- Key: `BYLINE_OWNER`
- Value: your name, as you want it to appear
- Environments: **Production** is selected by default. That's the live site; leave it.
- If the dialog asks for a type, **Secret** or **Config**, either works. Config lets you see the value again later by clicking the eye icon, which you'll want for `BYLINE_TOKENS` in step 7. Secret hides it after saving.
- **Save**

If you want an email when it's opened, add two more the same way. `BYLINE_RESEND_KEY` with a key from [Resend](https://resend.com): make a free account, click **API Keys** on the left, **Create API Key**, copy it. It's shown once; if you lose it, make another. Then `BYLINE_NOTIFY` with **the same email address you used to sign up for Resend.** That matters: Resend's shared sender will only deliver to the account's own address. Use a different one and nothing arrives, with no error you'd see. Once you've verified a domain of your own in Resend, any address works. The full list of settings, including gated mode, is in the [README](../README.md#settings).

Unlike uploading a file, changing settings does **not** redeploy on its own. Go to the **Deployments** tab, click the three dots on the right of the top row, and choose **Redeploy**.

**5. Wait about a minute.** The newest deployment shows a green **Ready** when it's live. If it shows red, click it, scroll to the red line, and it names the file it couldn't find. Almost always the PDF isn't at the top level of the repository, or it's named wrong. Fix that and it redeploys itself.

**6. Open it yourself, then send it.** Take the site address from step 1 and add the recipient. For a PDF, the link goes to `/viewer`; the bare address without `/viewer` shows a short demo page about Byline, so give people the full link:

```
https://byline-abc123.vercel.app/viewer?for=Acme%20Team      (PDF)
https://byline-abc123.vercel.app/?for=Acme%20Team            (HTML)
```

`%20` is how a space is written in a web address. Letters, numbers, spaces, commas and full stops are fine in the name; an ampersand is written `%26`; anything else is quietly dropped. Use a different `?for=` for each company. Open the exact link in a private browsing window first. You'll see what they see, and if you set up email, that open is your test: check your inbox, then your spam folder. A link to a client is not the place to discover a typo.

**7. Lock it (optional).** Everything so far is open mode: anyone with the link can open it. Gated mode adds a code per reader, and it's the mode to use for anything you'd be unhappy to see forwarded.

- Make a code. In a terminal: `openssl rand -hex 16`. Without one: your password manager's generator, set to 32 characters, letters and digits only.
- Back in **Environment Variables**, add `BYLINE_TOKENS` with the value `thatcode:Client Name`. **The name is required.** A code with nothing after the colon, or no colon at all, makes every page show "This document is not available right now" until you fix it. More readers go on the same line, separated by commas: `code1:Acme,code2:Globex`.
- Redeploy, same as step 4. Settings never redeploy on their own.
- Send the link with the code in it: `https://byline-abc123.vercel.app/?key=thatcode` for a page, or `/viewer?key=thatcode` for a PDF. The code travels inside the link; they click and it opens. The name on the stamp comes from the code, so there's no `?for=` in gated links. If you'd rather send the code separately from the link, they type it into the box on the gate page once.
- To take one reader's access away, delete their `code:Name` from the value, save, redeploy. Their link and their browser both stop working within a minute. Nobody else is affected.
- Any valid code opens everything in this project. If you're sending different documents to people who shouldn't see each other's, use one project per client (Deploy button again), not one project with several files.

---

## Common questions

**What does the client see?** The document, with a faint diagonal stamp across it reading CONFIDENTIAL · PREPARED FOR THEIR NAME · BY YOUR NAME. No login, no account, no "request access". They are not emailed, and nothing on the page tells them you were. Whether to mention that is up to you. Your name doesn't appear anywhere else on the page; the small "Byline" mark in the corner links to this project.

**What does it cost, and can I use it for client work?** GitHub is free for private repositories. Vercel's free Hobby plan is, in [their words](https://vercel.com/docs/plans/hobby), for "non-commercial, personal use only". Sending a paid client a proposal is commercial. Vercel Pro is $20 a month and removes that restriction; if your Vercel dashboard already shows a **Pro** badge next to your team name, none of this applies to you. On Hobby, an account that trips a limit or the fair-use policy gets **paused**, not billed, which means a dead link rather than a surprise invoice. If you can't afford the link going dark mid-conversation, upgrade before you send. Resend's free tier has no such clause.

**Do I need my own domain?** No. `byline-abc123.vercel.app` works identically: same stamp, same gate, same notifications, same security. The reason to use your own is delivery. Corporate link scanners flag unfamiliar `.vercel.app` addresses more often than a domain with history, and enterprise clients are exactly who runs those scanners. If you have a domain, point it at the project under **Settings**, **Domains**.

**The link shows no preview in Slack or email.** Correct, and on purpose: the site refuses link-preview bots because a preview bot fetching your page is still a fetch of your page. If a bare link worries you, put a sentence around it. Related: your client's email security may open the link automatically to scan it. That doesn't count as an open, because the notification is sent by the page itself after it has drawn the stamp, and scanners don't run pages.

**Can I send the same site to two clients?** For the same document, yes: give each their own `?for=` link in open mode, or their own code in gated mode. For two different documents, click the Deploy button again to make a second project. A code opens the whole project, not one file, so either client could otherwise open the other's document by guessing its filename, and uploading a new `document.pdf` replaces the old one for everyone who has the old link. Vercel's free plan allows 200 projects.

**Can they download or print it?** They can print, and save the rendered image, and both carry the stamp. Someone who knows their way around a browser can still get the original file. This deters casual forwarding; it does not stop a determined person. The README's Limitations section says exactly what it can't do.

**Does it work on a phone?** Yes. The page scales to the screen and the stamp scales with it. If your PDF is large, say 30 MB of images, it loads at whatever speed their connection allows; there's no size limit beyond what GitHub accepts for a single file, which is 100 MB.

**How do I take it down?** Open the file on GitHub, click the trash icon, commit. Or delete the whole Vercel project under **Settings**.

**How do I update the document after sending?** Upload the new file over the old one. Same link, new version, about a minute later.

**What if the link is broken?** They see Vercel's plain "not found" page. It doesn't show your name or the repository.

**Every page says "This document is not available right now."** `BYLINE_TOKENS` is set but nothing in it is usable, and Byline refuses to serve anything rather than guess. Almost always it's a code with no `:Name` after it. Open the variable, make it `code:Name`, save, redeploy.

**My own link says the code isn't valid.** Three causes, in order of likelihood. The code in your link doesn't match the one saved: open the variable in Vercel, copy the part before the colon from there, and paste it into the box on the gate page. Or the site is still running the old settings: **Deployments**, three dots on the top row, **Redeploy**. Or the variable was saved for **Preview** only; it needs **Production**.

**Link or attachment?** For a resume or a first application, send the file; recruiters want something that lands in their tracking system. For work someone specifically asked you to produce, a link is fine. That's my read, not a study. If they asked for an attachment, send the attachment.

**The page is blank.** For a PDF, check the file is named exactly `document.pdf` and sits at the top level of the repository, not in a folder. For the HTML path, check the two watermark lines are still at the bottom. If it's still blank, right-click the page, choose **Inspect**, click **Console**, and the red line names the file it couldn't find.

---

Back to the [README](../README.md) for the two modes, the settings, and the limitations.
