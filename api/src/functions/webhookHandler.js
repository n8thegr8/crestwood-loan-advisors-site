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
                
                // --- MULTIPART DEBUGGING ---
                const keysInfo = Array.from(formData.keys()).join(', ');
                const attachmentsCount = formData.get('attachments');
                const attachment1Blob = formData.get('attachment1');
                const isObj = typeof attachment1Blob === 'object';
                const constructorName = attachment1Blob && attachment1Blob.constructor ? attachment1Blob.constructor.name : 'Unknown';
                userRequest += `\n\n[DEBUG SENDGRID]:\nKeys: ${keysInfo}\nAttachments field: ${attachmentsCount}\nattachment1 exists: ${!!attachment1Blob}\nType: ${typeof attachment1Blob}\nIsObject: ${isObj}\nConstructor: ${constructorName}`;

                // Process attachments from SendGrid
                const numAttachments = parseInt(formData.get('attachments') || '0', 10);
                if (numAttachments > 0) {
                    const { uploadAsset } = require('../services/azureBlobService');
                    for (let i = 1; i <= numAttachments; i++) {
                        const fileBlob = formData.get(`attachment${i}`);
                        if (fileBlob && typeof fileBlob === 'object') {
                            const originalFilename = fileBlob.name || `attachment${i}`;
                            const mimetype = fileBlob.type || 'application/octet-stream';
                            const arrayBuffer = await fileBlob.arrayBuffer();
                            const buffer = Buffer.from(arrayBuffer);
                            
                            context.log(`Uploading attachment: ${originalFilename}`);
                            try {
                                const url = await uploadAsset(buffer, originalFilename, mimetype);
                                assetUrls.push(url);
                                context.log(`Attachment uploaded successfully: ${url}`);
                            } catch (uploadError) {
                                context.error(`Failed to upload attachment ${originalFilename}: ${uploadError.message}`);
                            }
                        }
                    }
                }
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

            // 4.5 Clean up old PRs to free up Azure environments before creating a new one
            context.log('Cleaning up old AI-generated PRs...');
            const { cleanupOldPullRequests } = require('../services/githubService');
            await cleanupOldPullRequests();

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
