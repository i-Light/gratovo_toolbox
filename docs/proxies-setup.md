# Proxies: setup

How to give the search more addresses to work from, so YouTube doesn't slow it down. Short steps, plain words. Written 2026-11-02, during step S ([scraping-upgrade-plan.md](scraping-upgrade-plan.md)).

The search reads YouTube's pages many times an hour. If all of that comes from one address, YouTube notices, and the address gets slowed down or blocked. Your home address could be one of them, and then YouTube is slow in your own browser too. Proxies and AWS gateways are other addresses the search can use instead.

There are two kinds you can use today. Both are free or nearly free:

| Kind | What it is | Cost | Lasts |
|---|---|---|---|
| **Free proxies** | Public servers that pass requests on | Free | Hours to a few days each. Refresh them often. |
| **AWS gateways** | Small relays in your own AWS account, one per region | Cents to about a dollar a month at our volume (AWS bills per million requests) | Until you remove them |

Paid proxies are off for now (your decision of 2026-11-02).

## 1. Free proxies

### Put them in the app

1. Get a fresh list. Ask Claude to "refresh the free proxies", or run the command in [Refresh the list](#refresh-the-list) below. You get a text file with up to 100 lines like `socks5://5.255.117.250:1080`.
2. In the app, open **Settings › Connections › Proxies**.
3. Click **Replace list** and paste the whole file into the box (one proxy per line).
4. Click **Save list**. It says "100 proxies saved".
5. In the same section, turn **Use proxies** on.
6. Turn **Also search directly** off. Your home address is then never used while a proxy or gateway is set. (Left on, it is used only while every proxy and gateway is cooling down after a block.) Off is the default since step S1, but a value you saved before stays as you set it.
7. Leave **Pacing** on **Normal**.
8. Optional: turn on **Run searches in parallel**. With many proxies, 4 at once is a good start.

The list is stored on this computer only and is never shown again. The search uses it from the next run.

### Refresh the list

Free proxies die fast. Refresh the list every day you search, or whenever the run log shows many "cooling down" lines.

The list comes from the free ProxyScrape list, about 1,500 entries. The command keeps the ones that, from this computer:

- answer YouTube within 10 seconds, and
- load a real YouTube search page with results and no "are you a robot" page.

It then writes the fastest 100. On 2026-11-02, 1,478 were listed, 394 answered YouTube, and the fastest 100 that passed the search test were written.

To run it yourself, open a terminal in the project folder and type:

```
cd services/pipeline
uv run python scripts/free_proxies.py --out "$HOME/free-proxies.txt"
```

Then paste the file as in [Put them in the app](#put-them-in-the-app).

From step S5 the app does this by itself. A switch in **Settings › Connections** fetches the list, checks it and refills it during a run, and this section goes away.

### Is it safe?

Free proxies are run by people we don't know, so the app limits what they can see:

- **They see only that we visit youtube.com, not what we read.** Every page is encrypted end to end, and the app checks YouTube's certificate on every request, so a proxy can't read or change a page.
- **They only ever carry page reads.** The YouTube API key never goes through a proxy. The API calls go straight to Google from this computer.
- **No sign-in ever goes through them.** The search reads YouTube signed out, with no cookies of yours.
- **A bad proxy costs nothing.** If one fails or is blocked, the search rests it and uses another.

Don't use a free proxy for anything else: no browsing, no email, and no passwords.

## 2. AWS gateways

A gateway is a small relay in your own AWS account. YouTube sees an Amazon address in that region, not yours. The app creates and removes the gateways itself; you only give it a key.

### Make a key that can only manage gateways

1. Sign in to the AWS console with your own account.
2. Open **IAM › Users › Create user**. Name it `gratovo-gateways`. Don't give it console access.
3. Under **Permissions**, choose **Attach policies directly › Create policy**, open the **JSON** tab, and paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["apigateway:GET", "apigateway:POST", "apigateway:PATCH", "apigateway:DELETE"],
         "Resource": "arn:aws:apigateway:*::/apis*"
       }
     ]
   }
   ```

   Name the policy `gratovo-gateways` and attach it to the user. The key can then manage API Gateway HTTP APIs and nothing else in your account. If your account has other HTTP APIs of its own, it could read or delete those too, so use an AWS account that has none, or ask Claude for a tighter policy.
4. Open the user, then **Security credentials › Create access key**, and pick **Application running outside AWS**.
5. Copy the **Access key ID** and the **Secret access key**. AWS shows the secret only once.

### Put the key in the app and deploy

1. Open **Settings › Connections › AWS gateways**.
2. Paste the two values and click **Save keys**. They are stored on this computer and never shown again.
3. Under **Regions to deploy to**, pick 4 to 6 regions spread around the world, for example US East (N. Virginia), US West (Oregon), Europe (Ireland), Europe (Frankfurt), Asia Pacific (Singapore) and Asia Pacific (Tokyo).
4. Click **Deploy to regions**, then **Deploy gateways**.
5. Turn **Use gateways** on.

To stop paying, click **Remove** next to a region. The gateways are deleted from your AWS account.

**One check before you rely on gateways.** Step S5 starts with a test that your home address doesn't leak through a gateway. You approved it on 2026-11-02, and its result goes into ADR 0023. Until then, use gateways together with free proxies, not on their own.

## 3. Checking that it works

After a few keywords, the run log has lines like "Routes used: 12 AWS, 40 proxy, 0 direct". **0 direct** means your home address wasn't used. From step S5, **Insights › Search › Routes** shows what each kind gave: blocks, channels found per 100 requests, and megabytes downloaded.

Never paste proxy lists or AWS keys into a chat, an issue or the repository.
