# SendGrid Inbound Parse Setup Guide

To allow your clients to email `changes@yourdomain.com` and have it automatically trigger the AI Site Manager, you need to configure **SendGrid Inbound Parse**.

Here is exactly what you need to do:

## Step 1: Add and Authenticate Your Domain in SendGrid
Before SendGrid can receive emails on behalf of a domain, it needs to verify that you own it.
1. Log in to your SendGrid dashboard.
2. Go to **Settings** -> **Sender Authentication**.
3. Under **Domain Authentication**, click **Get Started** or **Authenticate Your Domain**.
4. Choose your DNS host (e.g., GoDaddy, Cloudflare) and enter the domain you want to receive emails on (e.g., `natemaxfield.com` or a subdomain like `changes.natemaxfield.com`).
5. SendGrid will provide several **CNAME records**. Add these to your DNS provider.
6. Click **Verify** in SendGrid.

## Step 2: Configure MX Records for Inbound Parse
To tell the internet to route emails sent to `changes@yourdomain.com` directly to SendGrid's servers:
1. Go to your DNS provider.
2. Add an **MX Record**.
   - **Host / Name**: If you want to use a subdomain (recommended), like `updates.natemaxfield.com`, enter `updates`. If you want to use the root domain, enter `@`. 
   - **Value / Destination**: `mx.sendgrid.net.` (Make sure to include the trailing period depending on your DNS host).
   - **Priority**: `10`

*(Note: It is usually best practice to use a dedicated subdomain like `updates.natemaxfield.com` for inbound parsing so it doesn't conflict with your normal business email like Google Workspace on your root domain).*

## Step 3: Setup the Webhook in SendGrid
Now, you tell SendGrid where to forward the emails it receives.
1. In the SendGrid dashboard, go to **Settings** -> **Inbound Parse**.
2. Click **Add Host & URL**.
3. **Receiving Domain**: Enter the domain/subdomain you set up the MX record for (e.g., `updates.natemaxfield.com`).
4. **Destination URL**: Enter the deployed public URL of your Azure Function on your CUSTOM DOMAIN. Do not use the raw \`.azurestaticapps.net\` URL because it will trigger a 301 redirect and drop the email payload.
   - Exact URL: `https://crestwoodloanadvisors.com/api/webhookHandler`
5. **Check additional options**:
   - **DO NOT** check "POST the raw, full MIME message". Leave it unchecked. We want SendGrid to parse the email fields (like `from`, `subject`, and `text`) for us automatically!
6. Click **Add** or **Save**.

## Step 4: Test the Integration
1. Ensure your Azure Function is deployed and running.
2. Make sure the testing email address (e.g., your personal email) is added to the `ALLOWED_SENDERS` environment variable in Azure App Settings:
   `ALLOWED_SENDERS=your-email@gmail.com,client@theircompany.com`
3. Open your email client (Gmail, Outlook).
4. Send an email to `anything@updates.natemaxfield.com` (SendGrid catches *all* emails to that subdomain).
   - **Subject**: Make it purple!
   - **Body**: Please change the hero background to purple and make the text white.
5. Check your Azure Function logs. You should see it cleanly extract the sender, validate it, pull the text, and trigger the GitHub creation flow!
