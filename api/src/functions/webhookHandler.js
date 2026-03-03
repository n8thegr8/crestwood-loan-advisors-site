const { app } = require('@azure/functions');
const { fetchFile, createBranch, commitFile, createPullRequest } = require('../services/githubService');
const { modifyHtmlWithLlm } = require('../services/llmService');
const { sendPreviewEmail } = require('../services/emailService');

app.http('webhookHandler', {
    methods: ['POST'],
    authLevel: 'function',
    handler: async (request, context) => {
        context.log('Webhook payload received.');

        try {
            // Determine content type
            const contentType = request.headers.get('content-type') || '';
            let userRequest = '';
            let assetUrls = [];
            let senderEmail = '';
            let emailSubject = '';

            // Handle SendGrid Inbound Parse (multipart/form-data)
            if (contentType.includes('multipart/form-data')) {
                const formData = await request.formData();
                
                // Get the sender from SendGrid payload
                // SendGrid sends "from" which looks like: "Name <email@domain.com>" or just "email@domain.com"
                const fromField = formData.get('from') || '';
                const emailMatch = fromField.match(/<([^>]+)>/) || [null, fromField.trim()];
                senderEmail = emailMatch[1] || fromField.trim();
                
                // Use the text/plain body as the request
                userRequest = formData.get('text') || formData.get('subject') || '';
                emailSubject = formData.get('subject') || '';
                
                // Process attachments here in the future
                // const attachments = formData.get('attachments'); // SendGrid uses number of attachments
            } else if (contentType.includes('application/json')) {
                const body = await request.json();
                userRequest = body.request || body.text || '';
                senderEmail = body.sender || body.from || '';
                emailSubject = body.subject || '';
                if (body.assetUrls) assetUrls = body.assetUrls;
            } else {
                const text = await request.text();
                userRequest = text;
            }

            // Sender Validation Logic
            const allowedSendersRaw = process.env.ALLOWED_SENDERS || '';
            const allowedSenders = allowedSendersRaw.split(',').map(e => e.trim().toLowerCase());
            
            if (senderEmail && allowedSenders.length > 0 && !allowedSenders.includes(senderEmail.toLowerCase())) {
                context.log(`Rejected unauthorized sender: ${senderEmail}`);
                return { status: 403, body: `Sender ${senderEmail} is not authorized to make site changes.` };
            }

            if (!userRequest) {
                return { status: 400, body: 'User request content is required.' };
            }

            context.log(`Processing request: ${userRequest}`);

            // Check if this is a reply to an existing PR preview email
            const prMatch = emailSubject.match(/\[PR\s+#(\d+)\]/i);
            if (prMatch) {
                const prNumber = parseInt(prMatch[1], 10);
                const isApproval = /\b(approve|approved|looks good|lgtm|merge|go ahead|do it)\b/i.test(userRequest);
                
                if (isApproval) {
                    context.log(`Approval received for PR #${prNumber}. Merging...`);
                    const { mergePullRequest } = require('../services/githubService');
                    await mergePullRequest(prNumber);
                    return {
                        status: 200,
                        jsonBody: { message: `Successfully merged PR #${prNumber}.` }
                    };
                } else {
                    context.log(`Reply to PR #${prNumber} received, but no approval keyword found.`);
                    return {
                        status: 200,
                        jsonBody: { message: `No approval keyword found. Reply with 'Approved' to deploy.` }
                    };
                }
            }

            // 1. Fetch current HTML from staging branch
            context.log('Fetching index.html from staging branch...');
            const stagingFile = await fetchFile('staging', 'index.html');
            if (!stagingFile) {
                return { status: 500, body: 'index.html not found on staging branch.' };
            }

            // 2. Modify with LLM
            context.log('Calling LLM to modify HTML...');
            const newHtml = await modifyHtmlWithLlm(stagingFile.content, userRequest, assetUrls);

            // 3. Create unique branch from staging
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const newBranchName = `ai-update-${timestamp}`;
            
            context.log(`Creating new branch: ${newBranchName}`);
            await createBranch('staging', newBranchName);

            // 4. Commit updated file to new branch
            context.log('Committing changes to new branch...');
            await commitFile(
                newBranchName, 
                'index.html', 
                newHtml, 
                `Automated update from AI Site Manager\n\nRequest: ${userRequest}`, 
                stagingFile.sha
            );

            // 5. Open Pull Request to main branch to trigger Azure Preview Environment
            context.log('Creating Pull Request...');
            const pr = await createPullRequest(
                newBranchName, 
                'main', 
                `AI Update Request: ${userRequest.substring(0, 50)}`, 
                `## Automated PR by AI Site Manager\n\n**User Request:**\n> ${userRequest}`
            );

            context.log(`PR Created successfully: ${pr.html_url}`);
            
            // 5a. Await Azure Static Web Apps Build completion via GitHub Actions
            const { waitForPrBuild } = require('../services/githubService');
            context.log(`Waiting for preview environment to build for PR #${pr.number}...`);
            const buildSuccess = await waitForPrBuild(pr.number);
            
            // 6. Send the preview email to the original sender
            if (senderEmail && buildSuccess) {
                context.log(`Sending preview email to: ${senderEmail}`);
                try {
                    await sendPreviewEmail(senderEmail, pr.html_url, pr.number);
                } catch (emailError) {
                    context.error(`Failed to send preview email, but PR was created: ${emailError.message}`);
                }
            } else if (senderEmail && !buildSuccess) {
                context.error(`Aborting preview email to ${senderEmail} because the Azure build failed. PR was still created: ${pr.html_url}`);
            }
            
            return {
                status: 200,
                jsonBody: {
                    message: "Successfully processed request and created PR.",
                    prUrl: pr.html_url,
                    prNumber: pr.number
                }
            };
            
        } catch (error) {
            context.error(`Error processing webhook: ${error.message}`);
            return {
                status: 500,
                body: `Internal Server Error: ${error.message}`
            };
        }
    }
});
